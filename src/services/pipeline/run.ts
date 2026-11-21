import 'server-only';
/**
 * case.process — the 17 steps of PRD §22.1 over a Stepper, so the same code runs as an Inngest function (each step
 * memoised, retried, resumable) or inline when Inngest is not reachable (§J9 "Inline processing flag").
 * Consent is re-checked before every step from step 3 (CONS-9). Every failure ends with a person, never an approval.
 */
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { cases, tenants } from '@/db/schema/all';
import { randomId } from '@/lib/hash';
import { log } from '@/lib/log';
import {
  consentActive, failToPerson, initialState, payIfDue, pauseForConsent, stepChecks, stepCivil, stepDecide, stepExplainAndPersist, stepExtract,
  stepIdentity, stepInjection, stepLoadAndLock, stepNotify, stepSchedulePayment, stepSecondOpinion, stepTranscribe, stepVerifyDocuments, type RunState,
} from './steps';
import { loadCase } from './data';

const STOP = Symbol('stop');

export type Stepper = {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** cooling-off wait; inline runs return false (the payment is released later by payIfDue) */
  sleepUntil(name: string, at: Date): Promise<boolean>;
  mode: 'inngest' | 'inline';
};

export const inlineStepper = (): Stepper => ({
  mode: 'inline',
  run: async (_name, fn) => fn(),
  sleepUntil: async () => false,
});

export const PIPELINE_STEPS = [
  'load', 'consent', 'transcribe', 'documents', 'extract', 'injection', 'identity', 'civil', 'checks',
  'rules', 'score', 'second_opinion', 'decide', 'explain', 'notify', 'hold', 'pay',
] as const;

async function progress(db: DbOrTx, caseId: string, p: { mode: string; runId: string; step: string; done: string[]; startedAt: string; finishedAt?: string; outcome?: string }) {
  await db.update(cases).set({ pipeline: p }).where(eq(cases.id, caseId));
}

export async function runCaseProcess(db: DbOrTx, caseId: string, step: Stepper, opts: { asOf?: string } = {}) {
  const runId = randomId('run', 12);
  const startedAt = new Date().toISOString();
  const asOf = opts.asOf ?? startedAt;
  const state: RunState = initialState(asOf, runId);
  const done: string[] = [];
  let current = 'load';
  const mark = async (name: string) => { done.push(name); current = name; await progress(db, caseId, { mode: step.mode, runId, step: name, done: [...done], startedAt }); };

  try {
    // 1. load and lock
    const locked = await step.run('load', () => stepLoadAndLock(db, caseId));
    if (!locked.ok) return { runId, stopped: locked.reason };
    await mark('load');
    const c = await loadCase(db, caseId);
    if (!c) return { runId, stopped: 'not_found' };
    const [t] = await db.select({ isSandbox: tenants.isSandbox, code: tenants.code }).from(tenants).where(eq(tenants.id, c.tenantId)).limit(1);
    const demoTenant = process.env.DEMO_MODE === 'true' || !!t?.isSandbox;

    // 2. consent
    const consentOk = await step.run('consent', () => consentActive(db, c));
    if (!consentOk) { await step.run('consent-pause', () => pauseForConsent(db, caseId, 'consent')); return { runId, stopped: 'consent' }; }
    await mark('consent');

    /** CONS-9: before every step from 3, stop the run if consent was withdrawn meanwhile */
    const gated = async <T>(name: string, fn: () => Promise<T>): Promise<T | typeof STOP> => {
      const ok = await step.run(`${name}:consent`, () => consentActive(db, c));
      if (!ok) { await step.run(`${name}:pause`, () => pauseForConsent(db, caseId, name)); return STOP; }
      current = name;
      const out = await step.run(name, fn);
      await mark(name);
      return out;
    };

    // 3. transcribe pending voice
    if ((await gated('transcribe', () => stepTranscribe(db, caseId, demoTenant))) === STOP) return { runId, stopped: 'consent' };
    // 4. documents: QR signature, sharpness, image hash
    const docs = await gated('documents', () => stepVerifyDocuments(db, caseId));
    if (docs === STOP) return { runId, stopped: 'consent' };
    // 5. extraction + QR comparison
    const ex = await gated('extract', () => stepExtract(db, caseId, asOf));
    if (ex === STOP) return { runId, stopped: 'consent' };
    state.qrTextMismatch = ex.qrTextMismatch;
    state.qrTextAgree = ex.qrTextAgree;
    Object.assign(state.modelVersions, ex.models.extractor ? { extractor: ex.models.extractor } : {});
    if (ex.models.extractPrompt) state.promptVersions.extract = ex.models.extractPrompt;
    // 6. injection scan
    if ((await gated('injection', () => stepInjection(db, caseId))) === STOP) return { runId, stopped: 'consent' };
    // 7 and 8 run in parallel (each is still consent-gated)
    const [idr, civ] = await Promise.all([
      gated('identity', () => stepIdentity(db, caseId)),
      gated('civil', () => stepCivil(db, caseId)),
    ]);
    if (idr === STOP || civ === STOP) return { runId, stopped: 'consent' };
    state.identityAvailable = idr.available;
    state.services.identity = idr.available ? 'ok' : 'unavailable';
    state.services.civil = civ.available ? 'ok' : 'unavailable';
    // 9. duplicates and anomalies (a check that cannot run is not a pass → S8)
    const chk = await gated('checks', () => stepChecks(db, caseId));
    if (chk === STOP) return { runId, stopped: 'consent' };
    state.services.checks = chk.available ? 'ok' : 'unavailable';
    state.duplicates = chk.duplicates;
    state.anomalies = chk.anomalies;
    state.duplicateScore = chk.duplicateScore;
    state.helperAnomalyScore = chk.helperAnomalyScore;
    // 10–11: rules and score happen inside the pure decide(); evaluated once here for the second opinion's features
    const pre = await gated('rules', () => stepDecide(db, caseId, state, true).then((o) => ({ features: o.snapshot.features, rules: o.decision.rules.status })));
    if (pre === STOP) return { runId, stopped: 'consent' };
    await mark('score');
    // 12. Jev second opinion (skipped if unavailable; it can only escalate)
    const so = await gated('second_opinion', () => stepSecondOpinion(db, caseId, pre.features as unknown as Record<string, number>));
    if (so === STOP) return { runId, stopped: 'consent' };
    state.secondOpinion = so;
    // 13. decide (pure)
    const decided = await gated('decide', () => stepDecide(db, caseId, state, true));
    if (decided === STOP) return { runId, stopped: 'consent' };
    // 14. explain + persist the immutable decision row
    const persisted = await gated('explain', () => stepExplainAndPersist(db, caseId, state, decided));
    if (persisted === STOP) return { runId, stopped: 'consent' };
    // 15. notify (in-app always succeeds)
    if ((await gated('notify', () => stepNotify(db, caseId, persisted))) === STOP) return { runId, stopped: 'consent' };

    if (persisted.outcome !== 'AUTO_APPROVE') {
      await progress(db, caseId, { mode: step.mode, runId, step: 'done', done, startedAt, finishedAt: new Date().toISOString(), outcome: persisted.outcome });
      return { runId, outcome: persisted.outcome, decisionId: persisted.decisionId };
    }
    // 16. cooling-off hold
    const hold = await gated('hold', () => stepSchedulePayment(db, caseId, { type: 'system', id: 'pipeline:case.process' }));
    if (hold === STOP) return { runId, stopped: 'consent' };
    await progress(db, caseId, { mode: step.mode, runId, step: 'hold', done, startedAt, outcome: persisted.outcome });
    const slept = await step.sleepUntil('cooling-off', new Date(hold.holdUntil ?? Date.now()));
    // 17. pay (re-checks consent, freezes and pending payout changes itself)
    if (slept) {
      const paid = await gated('pay', () => payIfDue(db, hold.paymentId));
      if (paid === STOP) return { runId, stopped: 'consent' };
    }
    await progress(db, caseId, { mode: step.mode, runId, step: slept ? 'done' : 'hold', done, startedAt, finishedAt: new Date().toISOString(), outcome: persisted.outcome });
    return { runId, outcome: persisted.outcome, decisionId: persisted.decisionId, paymentId: hold.paymentId };
  } catch (e) {
    log('error', 'case.process failed', { caseId, step: current, error: e instanceof Error ? e.stack ?? e.message : String(e) });
    await failToPerson(db, caseId, current, e).catch(() => {});
    return { runId, failed: current };
  }
}

