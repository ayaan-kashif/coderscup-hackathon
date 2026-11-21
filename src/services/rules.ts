import 'server-only';
/**
 * F5 rule editor + F13 Digital Twin + RULE-4..7 publishing.
 *  - drafts are new versions; published versions are immutable (DB trigger);
 *  - the Twin replays stored snapshots under the draft with the pure decide(): no notifications, payments or case changes;
 *  - a run is tied to the draft's hash; a changed draft needs a new run;
 *  - a draft that would harm an in-flight case needs a second admin; publishing switches the pointer atomically
 *    (optimistic check → 409 for the second of two concurrent publishes); open cases are then re-decided and any
 *    that would get worse go to an officer (stop S11).
 */
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { cases, citizens, decisions, districts, programs, ruleSets, twinCaseResults, twinRuns } from '@/db/schema/all';
import { decide, outcomeRank, type Decision, type Snapshot } from '@/domain/decide';
import { validateRuleSet, type Costs, type Rule, type Thresholds } from '@/domain/rules/schema';
import type { ScorerArtifact } from '@/domain/scorer';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { hashJson } from '@/lib/hash';
import { auditorTrace, citizenExplanation, officerContributions, officerEvidence } from './explain';
import { latestArtifact, loadVersions } from './pipeline/data';
import { priorityFor } from './pipeline/steps';

const draftHash = (r: { rules: unknown; thresholds: unknown; costs: unknown }) => hashJson({ rules: r.rules, thresholds: r.thresholds, costs: r.costs });

export async function programFor(db: DbOrTx, tenantId: string) {
  const [p] = await db.select().from(programs).where(and(eq(programs.tenantId, tenantId), eq(programs.code, 'SAAYA-WS'))).limit(1);
  if (!p) throw new ApiError('NOT_FOUND', 'No programme in this office.');
  return p;
}

export async function listRuleSets(db: DbOrTx, tenantId: string) {
  const p = await programFor(db, tenantId);
  const rows = await db.select().from(ruleSets).where(eq(ruleSets.programId, p.id)).orderBy(desc(ruleSets.version));
  const runs = await db.select({ id: twinRuns.id, ruleSetId: twinRuns.ruleSetId, draftHash: twinRuns.draftHash, summary: twinRuns.summary, createdAt: twinRuns.createdAt }).from(twinRuns).where(eq(twinRuns.tenantId, tenantId)).orderBy(desc(twinRuns.createdAt));
  return {
    programId: p.id, activeRuleSetId: p.activeRuleSetId,
    versions: rows.map((r) => {
      const run = runs.find((x) => x.ruleSetId === r.id);
      return { id: r.id, version: r.version, status: r.status, active: r.id === p.activeRuleSetId, rules: r.rules, thresholds: r.thresholds, costs: r.costs, jsonHash: r.jsonHash, createdBy: r.createdBy, approvedBy: r.approvedBy, secondApprover: r.secondApprover, publishedAt: r.publishedAt, createdAt: r.createdAt, twin: run ? { id: run.id, current: run.draftHash === r.jsonHash, summary: run.summary } : null };
    }),
  };
}

export async function createDraft(db: DbOrTx, tenantId: string, adminId: string, fromId?: string) {
  const p = await programFor(db, tenantId);
  const srcId = fromId ?? p.activeRuleSetId;
  const [src] = srcId ? await db.select().from(ruleSets).where(and(eq(ruleSets.id, srcId), eq(ruleSets.tenantId, tenantId))).limit(1) : [];
  if (!src) throw new ApiError('VALIDATION_FAILED', 'Nothing to copy from.');
  const [m] = await db.select({ v: max(ruleSets.version) }).from(ruleSets).where(eq(ruleSets.programId, p.id));
  const [row] = await db.insert(ruleSets).values({ programId: p.id, tenantId, version: (m?.v ?? 0) + 1, status: 'draft', rules: src.rules, thresholds: src.thresholds, costs: src.costs, jsonHash: src.jsonHash, createdBy: adminId }).returning();
  return row!;
}

async function draftRow(db: DbOrTx, id: string) {
  const [r] = await db.select().from(ruleSets).where(eq(ruleSets.id, id)).limit(1);
  if (!r) throw new ApiError('NOT_FOUND');
  if (r.status !== 'draft') throw new ApiError('CASE_STATE', `Version ${r.version} is ${r.status}; published versions never change. Create a new draft.`);
  return r;
}

/** RULE-1 / F5: an invalid draft cannot be saved */
export async function updateDraft(db: DbOrTx, id: string, body: { rules: unknown; thresholds: unknown; costs: unknown }) {
  const r = await draftRow(db, id);
  const v = validateRuleSet(body);
  if (!v.ok) throw new ApiError('VALIDATION_FAILED', 'The draft breaks the rule schema.', { extra: { errors: v.errors } });
  const h = draftHash(v.value);
  await db.update(ruleSets).set({ rules: v.value.rules, thresholds: v.value.thresholds, costs: v.value.costs, jsonHash: h, secondApprover: null, approvedBy: null }).where(eq(ruleSets.id, r.id));
  return { id: r.id, version: r.version, jsonHash: h };
}

async function draftVersions(db: DbOrTx, r: typeof ruleSets.$inferSelect, scorerVersion?: string) {
  return {
    ruleSet: { id: r.id, version: r.version, rules: r.rules as Rule[], thresholds: r.thresholds as Thresholds, costs: r.costs as Costs },
    scorer: await latestArtifact<ScorerArtifact>(db, 'scorer', scorerVersion),
  };
}

/** RULE-8 preview: the draft against one case's stored snapshot, next to its current decision */
export async function previewDraft(db: DbOrTx, id: string, caseId: string, tenantId: string) {
  const [r] = await db.select().from(ruleSets).where(and(eq(ruleSets.id, id), eq(ruleSets.tenantId, tenantId))).limit(1);
  if (!r) throw new ApiError('NOT_FOUND');
  const [d] = await db.select().from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.tenantId, tenantId), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt)).limit(1);
  if (!d) throw new ApiError('VALIDATION_FAILED', 'This case has no decision to preview against.');
  const snap = { ...(d.snapshot as Snapshot), prior: null };
  const out = decide(snap, await draftVersions(db, r, d.scorerVersion ?? undefined));
  return { caseId, current: { outcome: d.outcome, gates: d.gates }, draft: { outcome: out.outcome, proposedAction: out.proposedAction, stops: out.stops.map((s) => s.code), rules: out.rules.results.map((x) => ({ ruleId: x.ruleId, result: x.result })) } };
}

const OPEN = ['submitted', 'processing', 'needs_proof', 'in_review', 'approved_on_hold', 'paused_for_consent', 'frozen'] as const;

/** TWIN-1..4: replay stored snapshots (last 90 days + all open cases) under the draft; diff; count in-flight harm */
export async function runTwin(db: DbOrTx, id: string, tenantId: string, adminId: string, asOf = new Date().toISOString()) {
  const [r] = await db.select().from(ruleSets).where(and(eq(ruleSets.id, id), eq(ruleSets.tenantId, tenantId))).limit(1);
  if (!r) throw new ApiError('NOT_FOUND');
  const versions = await draftVersions(db, r);
  const rows = await db.select({ d: decisions, status: cases.status, amount: programs.benefitAmount, district: districts.code, name: citizens.nameDisplay })
    .from(decisions).innerJoin(cases, eq(cases.id, decisions.caseId)).innerJoin(programs, eq(programs.id, cases.programId))
    .leftJoin(citizens, eq(citizens.id, cases.citizenId)).leftJoin(districts, eq(districts.id, citizens.districtId))
    .where(and(eq(decisions.tenantId, tenantId), eq(decisions.actorType, 'system'), sql`${decisions.createdAt} > now() - interval '90 days'`))
    .orderBy(desc(decisions.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const x of rows) if (!latest.has(x.d.caseId)) latest.set(x.d.caseId, x);
  const [run] = await db.insert(twinRuns).values({ tenantId, ruleSetId: r.id, draftHash: r.jsonHash, createdBy: adminId }).returning();
  const by = { better: 0, worse: 0, same: 0 };
  const byDistrict: Record<string, { better: number; worse: number }> = {};
  const affected: { caseId: string; name: string; district: string | null; from: string; to: string; direction: string; inFlight: boolean }[] = [];
  let harm = 0, payoutDelta = 0;
  for (const x of latest.values()) {
    const snap = { ...(x.d.snapshot as Snapshot), prior: null };
    let out: Decision;
    try { out = decide(snap, versions); } catch { continue; }
    const before = { outcome: x.d.outcome as Decision['outcome'], proposedAction: x.d.proposedAction as Decision['proposedAction'] };
    const ra = outcomeRank(before), rb = outcomeRank(out);
    const direction = rb > ra ? 'worse' : rb < ra ? 'better' : 'same';
    const inFlight = (OPEN as readonly string[]).includes(x.status);
    const isHarm = direction === 'worse' && inFlight;
    by[direction]++;
    if (isHarm) harm++;
    if (direction !== 'same') {
      const d = x.district ?? '—';
      byDistrict[d] ??= { better: 0, worse: 0 };
      byDistrict[d][direction as 'better' | 'worse']++;
      if (out.outcome === 'AUTO_APPROVE' && before.outcome !== 'AUTO_APPROVE') payoutDelta += x.amount;
      if (before.outcome === 'AUTO_APPROVE' && out.outcome !== 'AUTO_APPROVE') payoutDelta -= x.amount;
      // masked names (TWIN-2): first letter and the length only
      affected.push({ caseId: x.d.caseId, name: x.name ? `${x.name[0]}${'•'.repeat(Math.max(2, x.name.length - 1))}` : '—', district: x.district, from: before.outcome + (before.proposedAction === 'reject' ? ' (reject)' : ''), to: out.outcome + (out.proposedAction === 'reject' ? ' (reject)' : ''), direction, inFlight });
      await db.insert(twinCaseResults).values({ twinRunId: run!.id, caseId: x.d.caseId, oldOutcome: before.outcome, newOutcome: out.outcome, direction, inFlight, harm: isHarm, details: { stops: out.stops.map((s) => s.code), ruleStatus: out.rules.status } });
    }
  }
  const summary = { snapshots: latest.size, ...by, inFlightHarm: harm, payoutDelta, byDistrict, affected: affected.slice(0, 200), asOf, draftVersion: r.version, needsSecondAdmin: harm > 0 };
  await db.update(twinRuns).set({ status: 'done', summary, finishedAt: new Date() }).where(eq(twinRuns.id, run!.id));
  await db.update(ruleSets).set({ twinRunId: run!.id }).where(eq(ruleSets.id, r.id));
  return { id: run!.id, draftHash: r.jsonHash, summary };
}

export async function getTwin(db: DbOrTx, id: string) {
  const [r] = await db.select().from(twinRuns).where(eq(twinRuns.id, id)).limit(1);
  return r ?? null;
}

/** RULE-7: the second admin approves a harmful draft (never the one who made it) */
export async function approveDraft(db: DbOrTx, id: string, adminId: string) {
  const r = await draftRow(db, id);
  if (r.createdBy === adminId) throw new ApiError('FORBIDDEN_ROLE', 'A second admin must approve; you created this draft.');
  if (!r.twinRunId) throw new ApiError('CASE_STATE', 'Run the Twin first.');
  const [t] = await db.select().from(twinRuns).where(eq(twinRuns.id, r.twinRunId)).limit(1);
  if (t?.draftHash !== r.jsonHash) throw new ApiError('CASE_STATE', 'The draft changed after the Twin run; run it again.');
  await db.update(ruleSets).set({ secondApprover: adminId }).where(eq(ruleSets.id, r.id));
  return r;
}

export async function publishDraft(db: DbOrTx, id: string, adminId: string, expectedActiveId: string | null) {
  const r = await draftRow(db, id);
  if (!r.twinRunId) throw new ApiError('CASE_STATE', 'Run the Twin before publishing (TWIN-3).');
  const [t] = await db.select().from(twinRuns).where(eq(twinRuns.id, r.twinRunId)).limit(1);
  if (!t || t.draftHash !== r.jsonHash) throw new ApiError('CASE_STATE', 'The draft changed after the Twin run; run it again before publishing.');
  const harm = (t.summary as { inFlightHarm?: number } | null)?.inFlightHarm ?? 0;
  if (harm > 0 && !r.secondApprover) throw new ApiError('CASE_STATE', `This version would make ${harm} in-flight case(s) worse; a second admin must approve first (RULE-7).`, { extra: { inFlightHarm: harm } });
  const [p] = await db.select().from(programs).where(eq(programs.id, r.programId)).for('update').limit(1);
  // optimistic check (§27.3 "two admins publish at once")
  if (expectedActiveId !== undefined && p!.activeRuleSetId !== expectedActiveId) throw new ApiError('STALE_VERSION', 'Another version was published meanwhile. Reload and run the Twin again.');
  const prev = p!.activeRuleSetId;
  if (prev) await db.update(ruleSets).set({ status: 'retired' }).where(eq(ruleSets.id, prev));
  await db.update(ruleSets).set({ status: 'published', publishedAt: new Date(), approvedBy: adminId }).where(eq(ruleSets.id, r.id));
  await db.update(programs).set({ activeRuleSetId: r.id }).where(eq(programs.id, r.programId));
  return { id: r.id, version: r.version, previous: prev, harm };
}

/** RULE-6: re-decide open cases with the new version (batches of 50); a worse outcome goes to an officer (S11) */
export async function redecideOpenCases(db: DbOrTx, tenantId: string, asOf = new Date().toISOString()) {
  const open = await db.select({ id: cases.id, status: cases.status, tenantId: cases.tenantId, activeRuleSetId: programs.activeRuleSetId, citizenId: cases.citizenId })
    .from(cases).innerJoin(programs, eq(programs.id, cases.programId))
    .where(and(eq(cases.tenantId, tenantId), inArray(cases.status, ['needs_proof', 'in_review', 'approved_on_hold']))).limit(500);
  let worse = 0, changed = 0;
  for (let i = 0; i < open.length; i += 50) {
    for (const c of open.slice(i, i + 50)) {
      const [prev] = await db.select().from(decisions).where(and(eq(decisions.caseId, c.id), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt)).limit(1);
      if (!prev?.ruleSetId) continue;
      const [prevRs] = await db.select({ version: ruleSets.version }).from(ruleSets).where(eq(ruleSets.id, prev.ruleSetId)).limit(1);
      const versions = await loadVersions(db, { tenantId, activeRuleSetId: c.activeRuleSetId });
      if (versions.ruleSet.id === prev.ruleSetId) continue;
      const snap: Snapshot = { ...(prev.snapshot as Snapshot), asOf, prior: { outcome: prev.outcome as Decision['outcome'], proposedAction: prev.proposedAction as Decision['proposedAction'], ruleSetVersion: prevRs?.version ?? 0 } };
      const d = decide(snap, versions);
      const isWorse = d.stops.some((s) => s.code === 'S11');
      if (isWorse) worse++;
      if (d.outcome !== prev.outcome || isWorse) changed++;
      const inputHash = hashJson(snap);
      const ev = officerEvidence(d, { matches: [] });
      const [row] = await db.insert(decisions).values({
        caseId: c.id, tenantId, previousDecisionId: prev.id, outcome: d.outcome, proposedAction: d.proposedAction, pLegit: d.pLegit, threshold: d.threshold.required,
        gates: d.stops.map((s) => s.code), ruleSetId: d.versions.ruleSetId, scorerVersion: d.versions.scorerVersion, modelVersions: prev.modelVersions, promptVersions: prev.promptVersions,
        inputHash, snapshot: snap, ruleTrace: d.ruleTrace, explanationCitizen: citizenExplanation(d),
        explanationAuditor: { ...auditorTrace(d, { inputHash, decisionHash: hashJson(d), costs: versions.costs ?? versions.ruleSet.costs, scorerVersion: d.versions.scorerVersion, modelVersions: prev.modelVersions, promptVersions: prev.promptVersions }), officer: { summary: { known: [], conflicts: [], why_stopped: ev.filter((e) => e.heading === 'why_stopped').map((e) => ({ text: e.text, cites: [e.id] })), would_settle: ev.filter((e) => e.heading === 'would_settle').map((e) => ({ text: e.text, cites: [e.id] })), source: 'template' }, evidence: ev, contributions: officerContributions(d), rules: d.rules, conflicts: d.conflicts, stops: d.stops, facts: d.facts, proofItem: d.proofItem }, redecidedOnPublish: true },
        actorType: 'system', actorId: 'rules.redecide',
      }).returning({ id: decisions.id });
      // a worse outcome is never applied silently: the case goes to a person
      if (isWorse || d.outcome === 'OFFICER_REVIEW') await db.update(cases).set({ status: 'in_review', route: isWorse ? 'S11' : (d.stops[0]?.code ?? 'below_threshold'), priority: priorityFor(d), currentDecisionId: row!.id, updatedAt: new Date() }).where(eq(cases.id, c.id));
      else await db.update(cases).set({ currentDecisionId: row!.id, updatedAt: new Date() }).where(eq(cases.id, c.id));
      await writeAudit(db, { actorType: 'system', actorId: 'rules.redecide', tenantId, subjectCitizenId: c.citizenId, action: 'decision.create', resourceType: 'decision', resourceId: row!.id, outcome: 'allowed', details: { caseId: c.id, outcome: d.outcome, stops: d.stops.map((s) => s.code), ruleSetVersion: d.versions.ruleSetVersion, inputHash, reason: 'rules_published' } });
    }
  }
  return { open: open.length, changed, worse };
}
