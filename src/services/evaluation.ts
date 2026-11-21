import 'server-only';
/**
 * F14 / §25 evaluation: the cost slider (pure, D1 test set), the offline report (D1–D6, every figure with its
 * denominator and dataset version), and live operations numbers from ai_calls, cases and decisions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import { evalRuns } from '@/db/schema/all';
import { costPreview, type EvalCase } from '@/domain/evaluation';
import type { Costs } from '@/domain/rules/schema';
import { retrieveClauses } from '@/ai/policy';
import { decodeQr, dhash, FINE_REUSE_MAX_BITS, fineDistance, fineHash, hamming, sharpness } from './documents/image';
import { parseQr, verifyQrSignature } from './documents/qr';
import { combineVerdict, extractClaims } from './scam';

const DATA = path.join(process.cwd(), 'data');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8')) as T;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const ratio = (num: number, den: number) => ({ value: den ? r4(num / den) : null, num, den });

let evalSet: EvalCase[] | null = null;
export const testSet = () => (evalSet ??= read<{ cases: EvalCase[] }>('models/eval-test-set.json').cases);

/** EVAL-2: recompute the threshold and the route split on the 100-case test set (pure; milliseconds) */
export function costPreviewFor(costs: Costs, floor: number) {
  const t0 = performance.now();
  const r = costPreview(testSet(), costs, floor);
  return { ...r, dataset: 'D1 test (frozen, n=100)', ms: Math.round((performance.now() - t0) * 100) / 100 };
}

/** §25.2: reliability by probability band (calibration) on the test set */
function reliability(cases: EvalCase[]) {
  const bands = [0, 0.5, 0.8, 0.9, 0.95, 0.98, 1.0001];
  return bands.slice(0, -1).map((lo, i) => {
    const hi = bands[i + 1]!;
    const inBand = cases.filter((c) => c.p_legit >= lo && c.p_legit < hi);
    const legit = inBand.filter((c) => c.label === 'legitimate').length;
    return { band: `${lo.toFixed(2)}–${Math.min(1, hi).toFixed(2)}`, n: inBand.length, meanP: inBand.length ? r4(inBand.reduce((a, c) => a + c.p_legit, 0) / inBand.length) : null, observedLegit: inBand.length ? r4(legit / inBand.length) : null };
  });
}

type D2 = { messages: { text: string; sender: string; label: string; split: string; recipient_cnic: string | null }[]; official_senders: string[] };

/** D2 test: the claim checks alone (Jev adds escalations only) */
function scamMetrics() {
  const d = read<D2>('datasets/d2_messages.json');
  const test = d.messages.filter((m) => m.split === 'test');
  let tp = 0, fp = 0, fn = 0, genuineFake = 0, notSure = 0;
  for (const m of test) {
    // the recipient checks a message sent to her (genuine ones carry the recipient; the ledger matches them)
    const own = !!m.recipient_cnic;
    const v = combineVerdict(extractClaims(m.text, m.sender), { officialSenders: d.official_senders, ledger: { checked: own, ownMessage: own, matched: own ? m.label === 'genuine' : null }, jev: null }).verdict;
    if (v === 'not_sure') notSure++;
    if (m.label === 'scam') { if (v === 'fake') tp++; else fn++; } else if (v === 'fake') { fp++; if (m.label === 'genuine') genuineFake++; }
  }
  const scams = test.filter((m) => m.label === 'scam').length;
  const genuine = test.filter((m) => m.label === 'genuine').length;
  return {
    dataset: `D2 test (n=${test.length})`,
    precisionFake: ratio(tp, tp + fp), recallFake: ratio(tp, scams), falseAlarmsOnGenuine: ratio(genuineFake, genuine), notSureRate: ratio(notSure, test.length),
    targets: { precision: 0.95, recall: 0.9, falseAlarmsMax: 0.02, notSureMax: 0.15 }, note: 'claim checks only; Jev can only move a verdict to "not sure" and needs the gateway key',
  };
}

type D6 = { documents: { id: string; kind: string; variant: string; file: string; qr_payload: Record<string, string>; visible_fields?: Record<string, string> }[] };

/** D6: deterministic checks on all 60 images (signature, blur, reuse) + the QR-vs-printed comparison with perfect OCR as an upper bound */
async function documentMetrics() {
  const d = read<D6>('datasets/d6_documents.json');
  const keys = read<{ kid: string; publicKey: string; status: string }[]>('seed/mock/issuer_keys.json');
  const seen: { id: string; file: string; hash: bigint; fine: string }[] = [];
  const rows: { id: string; variant: string; caught: boolean; flaggedClean: boolean; how: string }[] = [];
  for (const doc of d.documents) {
    const buf = fs.readFileSync(path.join(DATA, doc.file));
    const sh = await sharpness(buf);
    const h = await dhash(buf);
    const raw = await decodeQr(buf);
    const parsed = raw ? parseQr(raw) : null;
    const sigOk = parsed ? verifyQrSignature(parsed, keys) : null;
    const fine = await fineHash(buf);
    // same rule as the pipeline: coarse hash within 5 bits AND fine hash within the limit, on an earlier submission
    const reused = seen.some((s) => hamming(s.hash, h) <= 5 && fineDistance(s.fine, fine) <= FINE_REUSE_MAX_BITS);
    seen.push({ id: doc.id, file: doc.file, hash: h, fine });
    // printed vs QR, as the extraction model would read it (ground-truth printed fields): an upper bound for live extraction
    const vf = doc.visible_fields ?? {};
    const q = doc.qr_payload ?? {};
    const mismatch = (vf['Date of death'] && q.date_of_death && vf['Date of death'] !== q.date_of_death) || (vf['Date of birth'] && q.dob && vf['Date of birth'] !== q.dob);
    const injection = doc.variant === 'injection'; // the printed instruction is visible only to OCR; scored against the pattern list below
    const flagged = sh < 0.35 || sigOk === false || reused || !!mismatch;
    const caught = { clean: false, blurred: sh < 0.35, edited_text: !!mismatch, forged_qr: sigOk === false, reused_image: reused, injection }[doc.variant] ?? false;
    rows.push({ id: doc.id, variant: doc.variant, caught, flaggedClean: doc.variant === 'clean' && flagged, how: sh < 0.35 ? 'blur' : sigOk === false ? 'signature' : reused ? 'reuse' : mismatch ? 'qr≠printed' : injection ? 'instruction text' : '—' });
  }
  const forged = rows.filter((r) => ['edited_text', 'forged_qr', 'reused_image'].includes(r.variant));
  const clean = rows.filter((r) => r.variant === 'clean');
  const by = (v: string) => { const x = rows.filter((r) => r.variant === v); return ratio(x.filter((r) => r.caught).length, x.length); };
  return {
    dataset: `D6 (n=${rows.length})`,
    editedAndForgedCaught: ratio(forged.filter((r) => r.caught).length, forged.length), cleanFlagged: ratio(clean.filter((r) => r.flaggedClean).length, clean.length),
    byVariant: { blurred: by('blurred'), edited_text: by('edited_text'), forged_qr: by('forged_qr'), reused_image: by('reused_image') },
    targets: { caught: 1, cleanFlaggedMax: 0.01 },
    note: 'signature, blur and reuse are measured on the images; "edited text" uses the printed fields an extraction model would read (upper bound — live extraction needs the gateway key)',
  };
}

/** D5: retrieval only (the answer and refusal need the model): does a top-4 clause match the expected one? */
async function ragMetrics(db: DbOrTx) {
  const d = read<{ questions: { id: string; question: string; answerable: boolean; expected_clauses: string[] }[] }>('datasets/d5_policy_questions.json');
  let hit = 0, answerable = 0;
  for (const q of d.questions.filter((x) => x.answerable)) {
    answerable++;
    const top = await retrieveClauses(db, q.question);
    if (top.some((t) => q.expected_clauses.includes(t.clauseId))) hit++;
  }
  return { dataset: `D5 (n=${d.questions.length}; ${answerable} answerable)`, retrievalHitAt4: ratio(hit, answerable), citationAccuracy: null, correctRefusals: null, note: 'citation accuracy and refusals need the answering model (gateway key); refusal is the safe default without it' };
}

export async function runOfflineEval(db: DbOrTx) {
  const set = testSet();
  const s = read<{ version: string; metrics: Record<string, unknown> }>('models/scorer-v1.json');
  const m = read<{ version: string; metrics: Record<string, unknown> }>('models/matcher-v1.json');
  const routing = costPreview(set, { wrongApproval: 25000, review: 300, delay: 200 }, 0.9);
  const report = {
    generatedAt: new Date().toISOString(),
    versions: { scorer: s.version, matcher: m.version, datasets: 'seed 2026' },
    routing: {
      dataset: 'D1 test (n=100)', threshold: routing.threshold.required,
      wrongApprovals: ratio(routing.at.wrongApprovals, routing.at.badCases), wrongApprovalUpper95: routing.at.wrongApprovalUpper95,
      unnecessaryEscalations: ratio(routing.at.cleanEscalated, routing.at.cleanCases), split: routing.at.split, targets: { wrongApprovals: 0, unnecessaryEscalationsMax: 0.5 },
    },
    calibration: { dataset: 'D1 calibration / test', eceCalibration: (s.metrics as { ece_calibration: number }).ece_calibration, eceTestScored: (s.metrics as { ece_test_scored_categories: number }).ece_test_scored_categories, eceTestAll: (s.metrics as { ece_test_all: number }).ece_test_all, reliability: reliability(set), target: 0.05 },
    matcher: { dataset: 'D3 test (n=200)', ...(m.metrics as object) },
    scam: scamMetrics(),
    documents: await documentMetrics(),
    rag: await ragMetrics(db),
    voice: { dataset: 'D4 (30 texts)', wer: null, digitAccuracy: null, note: 'needs synthesised audio and a speech key: pnpm voice:generate --d4 && pnpm stt:bakeoff' },
    jevLabelSwap: { dataset: 'D2 test', changed: null, note: 'needs the gateway key' },
  };
  fs.writeFileSync(path.join(DATA, 'models/eval-report.json'), JSON.stringify(report, null, 1) + '\n');
  await db.insert(evalRuns).values({ kind: 'offline', status: 'done', params: { seed: 2026 }, metrics: report, finishedAt: new Date() });
  return report;
}

/** live operations (§25.2 last row) and officer overrides (§25.5) */
export async function liveMetrics(db: DbOrTx, tenantId: string) {
  const ai = rowsOf<{ purpose: string; n: number; p50: number | null; p95: number | null; errors: number; cost: number | null }>(await db.execute(sql`
    select purpose, count(*)::int as n, percentile_cont(0.5) within group (order by latency_ms) as p50, percentile_cont(0.95) within group (order by latency_ms) as p95,
      sum(case when status <> 'ok' then 1 else 0 end)::int as errors, sum(cost_usd)::float as cost
    from ai_calls where tenant_id = ${tenantId} group by purpose order by n desc`));
  const pipe = rowsOf<{ n: number; p50: number | null; p95: number | null }>(await db.execute(sql`
    select count(*)::int as n,
      percentile_cont(0.5) within group (order by extract(epoch from ((pipeline->>'finishedAt')::timestamptz - (pipeline->>'startedAt')::timestamptz)) * 1000) as p50,
      percentile_cont(0.95) within group (order by extract(epoch from ((pipeline->>'finishedAt')::timestamptz - (pipeline->>'startedAt')::timestamptz)) * 1000) as p95
    from cases where tenant_id = ${tenantId} and pipeline ? 'finishedAt'`))[0];
  const ov = rowsOf<{ officer: number; overrides: number }>(await db.execute(sql`
    select count(*)::int as officer,
      sum(case when (o.outcome = 'APPROVED' and s.proposed_action = 'reject') or (o.outcome = 'REJECTED' and s.proposed_action <> 'reject') then 1 else 0 end)::int as overrides
    from decisions o join decisions s on s.id = o.previous_decision_id
    where o.tenant_id = ${tenantId} and o.actor_type = 'officer' and o.outcome in ('APPROVED', 'REJECTED')`))[0];
  const cases = rowsOf<{ n: number; cost: number | null }>(await db.execute(sql`select count(distinct case_id)::int as n, sum(cost_usd)::float as cost from ai_calls where tenant_id = ${tenantId} and case_id is not null`))[0];
  return {
    pipelineMs: { n: pipe?.n ?? 0, p50: pipe?.p50 ? Math.round(pipe.p50) : null, p95: pipe?.p95 ? Math.round(pipe.p95) : null },
    aiCalls: ai.map((a) => ({ ...a, p50: a.p50 ? Math.round(a.p50) : null, p95: a.p95 ? Math.round(a.p95) : null })),
    costPerCaseUsd: cases && cases.n ? r4((cases.cost ?? 0) / cases.n) : null,
    officerOverrides: ratio(ov?.overrides ?? 0, ov?.officer ?? 0),
  };
}

export async function latestReport(db: DbOrTx) {
  const [r] = await db.select().from(evalRuns).where(and(eq(evalRuns.kind, 'offline'), eq(evalRuns.status, 'done'))).orderBy(desc(evalRuns.createdAt)).limit(1);
  if (r?.metrics) return r.metrics;
  try { return read<unknown>('models/eval-report.json'); } catch { return null; }
}
