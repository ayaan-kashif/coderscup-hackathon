import 'server-only';
/**
 * Officer console services (F7, CASE-4, CASE-6, OQ-1..5) and deterministic replay (DEC-9, EXP-3).
 * Officer actions are decision rows (actor_type = officer, reason code) linked to the system decision they act on.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '@/auth/actor';
import { maskCnic } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { cases, citizens, decisions, districts, documents, identityMatches, memberships, payments, proofRequests, users } from '@/db/schema/all';
import { decide, type Decision, type Snapshot } from '@/domain/decide';
import { ApiError } from '@/lib/errors';
import { hashJson } from '@/lib/hash';
import { notifyCitizen } from './notify';
import { latestArtifact, loadCase, loadVersions } from './pipeline/data';
import { releaseDuePayments, stepSchedulePayment } from './pipeline/steps';
import type { ScorerArtifact } from '@/domain/scorer';
import type { Costs } from '@/domain/rules/schema';

export const queueQuery = z.object({
  route: z.string().max(40).optional(),
  district: z.string().max(8).optional(),
  stop: z.string().regex(/^S\d{1,2}$/).optional(),
  mine: z.enum(['true', 'false']).optional(),
  status: z.enum(['in_review', 'needs_proof', 'frozen', 'all_open']).optional(),
  minAgeHours: z.coerce.number().min(0).max(24 * 365).optional(),
});

/** OQ-1/OQ-2: priority (stop severity, waiting time, vulnerability), then lowest confidence */
export async function officerQueue(db: DbOrTx, actor: Actor, q: z.infer<typeof queueQuery>) {
  await releaseDuePayments(db, actor.tenantId).catch(() => {});
  const statuses = q.status && q.status !== 'all_open' ? [q.status] : ['in_review', 'needs_proof', 'frozen', 'approved_on_hold', 'disputed', 'processing', 'submitted'];
  const rows = await db.select({
    id: cases.id, status: cases.status, route: cases.route, priority: cases.priority, createdAt: cases.createdAt, submittedAt: cases.submittedAt,
    assignedOfficerId: cases.assignedOfficerId, escalatedTo: cases.escalatedTo, frozenReason: cases.frozenReason, firstOpenedAt: cases.firstOpenedAt,
    district: districts.code, gates: decisions.gates, pLegit: decisions.pLegit, threshold: decisions.threshold, outcome: decisions.outcome,
  }).from(cases)
    .leftJoin(citizens, eq(citizens.id, cases.citizenId))
    .leftJoin(districts, eq(districts.id, citizens.districtId))
    .leftJoin(decisions, eq(decisions.id, cases.currentDecisionId))
    .where(and(eq(cases.tenantId, actor.tenantId!), inArray(cases.status, statuses as never[])))
    .limit(500);
  const now = Date.now();
  const items = rows.map((r) => {
    const waitingH = (now - (r.submittedAt ?? r.createdAt).getTime()) / 3_600_000;
    return { ...r, waitingHours: Math.round(waitingH * 10) / 10, score: r.priority + Math.min(48, waitingH) };
  }).filter((r) => (!q.route || r.route === q.route) && (!q.district || r.district === q.district) && (!q.stop || (r.gates ?? []).includes(q.stop))
    && (q.mine !== 'true' || r.assignedOfficerId === actor.id || r.escalatedTo === actor.id) && (!q.minAgeHours || r.waitingHours >= q.minAgeHours))
    .sort((a, b) => b.score - a.score || (a.pLegit ?? 0) - (b.pLegit ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
  const counts: Record<string, number> = {};
  for (const r of items) for (const g of r.gates ?? []) counts[g] = (counts[g] ?? 0) + 1;
  return { items: items.slice(0, 200), total: items.length, countsByStop: counts };
}

/** O2: everything the officer needs, led by the stop and the fact that would settle it. Masks per verdict. */
export async function officerCaseView(db: DbOrTx, caseId: string, mask: string[] = []) {
  const c = await loadCase(db, caseId);
  if (!c) throw new ApiError('NOT_FOUND');
  const hide = new Set(mask);
  const [d] = c.currentDecisionId ? await db.select().from(decisions).where(eq(decisions.id, c.currentDecisionId)).limit(1) : [];
  const [sys] = await db.select().from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt)).limit(1);
  const docs = await db.select({ id: documents.id, docType: documents.docType, sharpness: documents.sharpness, qrSigValid: documents.qrSigValid, injectionFlag: documents.injectionFlag, weakSignals: documents.weakSignals, bytes: documents.bytes, createdAt: documents.createdAt, extraction: documents.extraction })
    .from(documents).where(eq(documents.caseId, caseId)).orderBy(desc(documents.createdAt));
  const matches = await db.select().from(identityMatches).where(eq(identityMatches.caseId, caseId)).orderBy(asc(identityMatches.rank));
  const proofs = await db.select().from(proofRequests).where(eq(proofRequests.caseId, caseId)).orderBy(desc(proofRequests.createdAt));
  const pays = await db.select().from(payments).where(eq(payments.caseId, caseId)).orderBy(desc(payments.createdAt));
  const history = await db.select({ id: decisions.id, outcome: decisions.outcome, actorType: decisions.actorType, actorId: decisions.actorId, reasonCode: decisions.reasonCode, note: decisions.note, gates: decisions.gates, createdAt: decisions.createdAt })
    .from(decisions).where(eq(decisions.caseId, caseId)).orderBy(desc(decisions.createdAt));
  const officer = (sys?.explanationAuditor as { officer?: Record<string, unknown> } | null)?.officer ?? null;
  const facts = (officer?.facts ?? {}) as Record<string, { key: string; value: unknown; source: string; ref?: string }>;
  const scrub = (k: string, v: unknown) => {
    if (k === 'payout.wallet' && v && typeof v === 'object') return { last4: (v as { last4?: string }).last4 };
    if (k === 'applicant.cnic' && typeof v === 'string') return maskCnic(v.replace(/\D/g, '').slice(-4));
    if (hide.has('name') && /name/.test(k)) return null;
    if (hide.has('dob') && /dob/.test(k)) return null;
    return v;
  };
  return {
    case: { id: c.id, tenantId: c.tenantId, status: c.status, route: c.route, priority: c.priority, channel: c.channel, createdAt: c.createdAt, submittedAt: c.submittedAt, firstOpenedAt: c.firstOpenedAt, assignedOfficerId: c.assignedOfficerId, escalatedTo: c.escalatedTo, frozenReason: c.frozenReason, closeReason: c.closeReason, amount: c.amount, pipeline: c.pipeline },
    citizen: c.citizen ? { id: c.citizen.id, name: hide.has('name') ? null : c.citizen.nameDisplay, cnic: maskCnic(c.citizen.cnicLast4), dob: hide.has('dob') ? null : c.citizen.dob, avatarId: c.citizen.avatarId } : null,
    decision: d ? { id: d.id, outcome: d.outcome, proposedAction: d.proposedAction, actorType: d.actorType, reasonCode: d.reasonCode, note: d.note, pLegit: d.pLegit, threshold: d.threshold, gates: d.gates, createdAt: d.createdAt } : null,
    systemDecision: sys ? {
      id: sys.id, outcome: sys.outcome, proposedAction: sys.proposedAction, pLegit: sys.pLegit, threshold: sys.threshold, gates: sys.gates, inputHash: sys.inputHash,
      ruleTrace: sys.ruleTrace, summary: officer?.summary ?? null, evidence: hide.size ? [] : officer?.evidence ?? [], contributions: officer?.contributions ?? [], stops: officer?.stops ?? [],
      rules: officer?.rules ?? null, conflicts: officer?.conflicts ?? [], proofItem: officer?.proofItem ?? null,
      facts: Object.values(facts).map((f) => ({ key: f.key, value: scrub(f.key, f.value), source: f.source, ref: f.ref })),
      modelVersions: sys.modelVersions, promptVersions: sys.promptVersions,
    } : null,
    documents: docs.map((x) => ({ ...x, extraction: hide.size ? null : x.extraction })),
    matches: matches.map((m) => {
      const rec = (m.fieldAgreements as { _record?: Record<string, string> })._record ?? {};
      const fields = Object.fromEntries(Object.entries(m.fieldAgreements as Record<string, unknown>).filter(([k]) => k !== '_record'));
      return { rank: m.rank, registryRecordId: m.registryRecordId, scoreBits: m.scoreBits, probability: m.probability, zone: m.zone, fields, record: hide.size ? { district: rec.district } : rec };
    }),
    proofs, payments: pays.map((p) => ({ id: p.id, amount: p.amount, status: p.status, holdUntil: p.holdUntil, ledgerRef: p.ledgerRef, sentAt: p.sentAt, confirmedAmount: p.confirmedAmount })),
    history,
  };
}

export const REJECT_REASONS = ['not_widow', 'remarried', 'income_above_limit', 'outside_programme_area', 'under_age', 'duplicate_application', 'document_forged', 'identity_not_confirmed'] as const;
export const APPROVE_REASONS = ['identity_confirmed_by_document', 'evidence_reviewed', 'registry_confirmed', 'proof_received', 'service_outage_reviewed'] as const;
export const CLOSE_REASONS = ['paid_and_confirmed', 'withdrawn', 'duplicate', 'ineligible_confirmed'] as const;

export const decisionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reasonCode: z.enum(APPROVE_REASONS), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject'), reasonCode: z.enum(REJECT_REASONS), note: z.string().min(5).max(500) }),
  z.object({ action: z.literal('request_proof'), item: z.enum(['cnic_front', 'cnic_back', 'death_certificate', 'income_declaration']), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('escalate'), note: z.string().min(5).max(500), toUserId: z.uuid().optional() }),
]);

const DECIDABLE = ['in_review', 'needs_proof', 'approved_on_hold', 'disputed'];

/** OQ-4: approve, reject (reason and note required), request proof, escalate to a senior officer */
export async function officerDecision(db: DbOrTx, actor: Actor, caseId: string, b: z.infer<typeof decisionBody>) {
  const c = await loadCase(db, caseId);
  if (!c) throw new ApiError('NOT_FOUND');
  if (c.status === 'frozen') throw new ApiError('CASE_STATE', 'Unfreeze the case first, with a reason.');
  if (c.status === 'paused_for_consent') throw new ApiError('CONSENT_WITHDRAWN', 'The citizen withdrew consent; the case is paused.');
  if (!DECIDABLE.includes(c.status)) throw new ApiError('CASE_STATE', `A ${c.status} case cannot take this action.`);
  const [sys] = await db.select().from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt)).limit(1);
  const [prev] = await db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, caseId)).orderBy(desc(decisions.createdAt)).limit(1);
  const base = {
    caseId, tenantId: c.tenantId, previousDecisionId: prev?.id ?? null, pLegit: sys?.pLegit ?? null, threshold: sys?.threshold ?? null, gates: sys?.gates ?? [],
    ruleSetId: sys?.ruleSetId ?? null, scorerVersion: sys?.scorerVersion ?? null, modelVersions: sys?.modelVersions ?? {}, promptVersions: sys?.promptVersions ?? {},
    inputHash: sys?.inputHash ?? hashJson({ caseId }), snapshot: sys?.snapshot ?? {}, ruleTrace: sys?.ruleTrace ?? [], actorType: 'officer' as const, actorId: actor.id,
  };
  let outcome: string, proposed: string, status: typeof cases.$inferSelect.status, reason: string | null = null, note: string | null = b.note ?? null;
  if (b.action === 'approve') {
    if (c.amount > 50_000 && !actor.isSenior) throw new ApiError('FORBIDDEN_ROLE', 'Amounts above the auto cap need a senior officer.');
    outcome = 'APPROVED'; proposed = 'approve_with_hold'; status = 'approved_on_hold'; reason = b.reasonCode;
  } else if (b.action === 'reject') {
    outcome = 'REJECTED'; proposed = 'reject'; status = 'rejected'; reason = b.reasonCode;
  } else if (b.action === 'request_proof') {
    outcome = 'REQUEST_PROOF'; proposed = 'request_proof'; status = 'needs_proof'; reason = `proof:${b.item}`;
    const [prior] = await db.select({ attempts: proofRequests.attempts }).from(proofRequests).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.item, b.item))).orderBy(desc(proofRequests.createdAt)).limit(1);
    if ((prior?.attempts ?? 0) >= 2) throw new ApiError('CASE_STATE', 'Both attempts for this item are used; decide from the evidence or type the fields.');
    await db.update(proofRequests).set({ status: 'cancelled' }).where(and(eq(proofRequests.caseId, caseId), eq(proofRequests.status, 'open')));
    await db.insert(proofRequests).values({ caseId, tenantId: c.tenantId, item: b.item, reasonCode: 'officer_request', attempts: prior?.attempts ?? 0 });
  } else {
    let to = b.toUserId;
    if (!to) {
      const [senior] = await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, c.tenantId), eq(memberships.role, 'officer'), eq(memberships.isSenior, true))).limit(1);
      to = senior?.id;
    }
    if (!to) throw new ApiError('VALIDATION_FAILED', 'No senior officer in this office.');
    const [m] = await db.select({ isSenior: memberships.isSenior }).from(memberships).where(and(eq(memberships.userId, to), eq(memberships.tenantId, c.tenantId), eq(memberships.role, 'officer'))).limit(1);
    if (!m?.isSenior) throw new ApiError('VALIDATION_FAILED', 'Escalate to a senior officer of this office.');
    outcome = 'ESCALATED'; proposed = 'review'; status = c.status as typeof status; reason = 'escalated';
    await db.update(cases).set({ escalatedTo: to, assignedOfficerId: to }).where(eq(cases.id, caseId));
    note = b.note;
  }
  const [row] = await db.insert(decisions).values({ ...base, outcome, proposedAction: proposed, reasonCode: reason, note }).returning({ id: decisions.id });
  await db.update(cases).set({ status, currentDecisionId: row!.id, updatedAt: new Date(), ...(b.action === 'approve' ? { route: 'officer_approved' } : {}) }).where(eq(cases.id, caseId));
  let payment: { paymentId: string; holdUntil: string | null } | null = null;
  if (b.action === 'approve') payment = await stepSchedulePayment(db, caseId, { type: 'officer', id: actor.id });
  return { decisionId: row!.id, outcome, status, payment, citizenId: c.citizenId, tenantId: c.tenantId, amount: c.amount, reason };
}

export async function notifyOfficerDecision(db: DbOrTx, r: Awaited<ReturnType<typeof officerDecision>>) {
  if (!r.citizenId) return;
  if (r.outcome === 'APPROVED') await notifyCitizen(db, { tenantId: r.tenantId, citizenId: r.citizenId, key: 'approved', vars: { amount: r.amount.toLocaleString('en-US') } });
  else if (r.outcome === 'REJECTED') await notifyCitizen(db, { tenantId: r.tenantId, citizenId: r.citizenId, key: 'rejected', vars: { reason: (r.reason ?? '').replace(/_/g, ' '), reason_ur: (r.reason ?? '').replace(/_/g, ' ') } });
  else if (r.outcome === 'REQUEST_PROOF') {
    const { proofText } = await import('./explain');
    const p = proofText((r.reason ?? '').replace('proof:', ''));
    await notifyCitizen(db, { tenantId: r.tenantId, citizenId: r.citizenId, key: 'proof_needed', vars: { item: p.en, item_ur: p.ur } });
  }
}

/** CASE-4 */
export async function freezeCase(db: DbOrTx, caseId: string, reason: string) {
  const c = await loadCase(db, caseId);
  if (!c) throw new ApiError('NOT_FOUND');
  if (['closed', 'rejected', 'confirmed', 'frozen'].includes(c.status)) throw new ApiError('CASE_STATE', `A ${c.status} case cannot be frozen.`);
  await db.update(cases).set({ status: 'frozen', frozenReason: reason, updatedAt: new Date(), pipeline: { ...(c.pipeline as object ?? {}), statusBeforeFreeze: c.status } }).where(eq(cases.id, caseId));
  await db.update(payments).set({ status: 'hold' }).where(and(eq(payments.caseId, caseId), eq(payments.status, 'scheduled')));
  return c;
}

export async function unfreezeCase(db: DbOrTx, caseId: string) {
  const c = await loadCase(db, caseId);
  if (!c) throw new ApiError('NOT_FOUND');
  if (c.status !== 'frozen') throw new ApiError('CASE_STATE', 'The case is not frozen.');
  // back to a person's review, never straight to payment
  await db.update(cases).set({ status: 'in_review', frozenReason: null, updatedAt: new Date() }).where(eq(cases.id, caseId));
  return c;
}

export async function assignCase(db: DbOrTx, caseId: string, tenantId: string, officerId: string) {
  const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, officerId), eq(memberships.tenantId, tenantId), eq(memberships.role, 'officer'))).limit(1);
  if (!m) throw new ApiError('VALIDATION_FAILED', 'Assign to an officer of this office.');
  await db.update(cases).set({ assignedOfficerId: officerId, updatedAt: new Date() }).where(eq(cases.id, caseId));
}

export async function closeCase(db: DbOrTx, caseId: string, reason: (typeof CLOSE_REASONS)[number]) {
  const c = await loadCase(db, caseId);
  if (!c) throw new ApiError('NOT_FOUND');
  if (c.status === 'closed') throw new ApiError('CASE_STATE', 'Already closed.');
  if (reason === 'paid_and_confirmed' && !['paid', 'confirmed'].includes(c.status)) throw new ApiError('CASE_STATE', 'Only a paid case closes as paid and confirmed.');
  await db.update(cases).set({ status: 'closed', closeReason: reason, updatedAt: new Date() }).where(eq(cases.id, caseId));
  await db.update(payments).set({ status: 'cancelled' }).where(and(eq(payments.caseId, caseId), inArray(payments.status, ['scheduled', 'hold'])));
  return c;
}

export async function staffName(db: DbOrTx, id: string) {
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.name ?? null;
}

/** DEC-9 / EXP-3: replay a stored decision with the exact versions it used; identical means identical hash */
export async function replayDecision(db: DbOrTx, decisionId: string) {
  const [d] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
  if (!d) throw new ApiError('NOT_FOUND');
  const [sys] = d.actorType === 'system' ? [d] : await db.select().from(decisions).where(and(eq(decisions.caseId, d.caseId), eq(decisions.actorType, 'system'), eq(decisions.inputHash, d.inputHash))).orderBy(desc(decisions.createdAt)).limit(1);
  if (!sys) throw new ApiError('VALIDATION_FAILED', 'This officer decision has no system decision to replay.');
  const aud = (sys.explanationAuditor ?? {}) as { decisionHash?: string; costs?: Costs; versions?: { scorerVersion?: string } };
  const c = await loadCase(db, sys.caseId);
  const versions = await loadVersions(db, { tenantId: sys.tenantId, activeRuleSetId: c?.activeRuleSetId ?? null }, { ruleSetId: sys.ruleSetId!, scorerVersion: sys.scorerVersion ?? undefined, costs: aud.costs });
  // the stored artifact by version, not "latest"
  versions.scorer = await latestArtifact<ScorerArtifact>(db, 'scorer', sys.scorerVersion ?? undefined);
  const snapshot = sys.snapshot as Snapshot;
  const inputHashNow = hashJson(snapshot);
  const replayed: Decision = decide(snapshot, versions);
  const hashNow = hashJson(replayed);
  const identical = hashNow === aud.decisionHash && inputHashNow === sys.inputHash;
  return {
    decisionId, systemDecisionId: sys.id, identical, inputHash: sys.inputHash, inputHashNow, decisionHash: aud.decisionHash ?? null, decisionHashNow: hashNow,
    stored: { outcome: sys.outcome, gates: sys.gates, pLegit: sys.pLegit, threshold: sys.threshold },
    replayed: { outcome: replayed.outcome, gates: replayed.stops.map((s) => s.code), pLegit: replayed.pLegit, threshold: replayed.threshold.required },
    officerOverride: d.actorType === 'officer' ? { outcome: d.outcome, reasonCode: d.reasonCode, actorId: d.actorId } : null,
    versions: { ruleSetId: sys.ruleSetId, scorerVersion: sys.scorerVersion, models: sys.modelVersions, prompts: sys.promptVersions },
  };
}

export async function decisionTrace(db: DbOrTx, decisionId: string, mask: string[]) {
  const [d] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
  if (!d) return null;
  const hide = mask.length > 0;
  const aud = d.explanationAuditor as Record<string, unknown> | null;
  return {
    id: d.id, caseId: d.caseId, tenantId: d.tenantId, previousDecisionId: d.previousDecisionId, outcome: d.outcome, proposedAction: d.proposedAction,
    pLegit: d.pLegit, threshold: d.threshold, gates: d.gates, ruleSetId: d.ruleSetId, scorerVersion: d.scorerVersion, modelVersions: d.modelVersions, promptVersions: d.promptVersions,
    inputHash: d.inputHash, ruleTrace: hide ? (d.ruleTrace as { ruleId: string; result: string }[]).map((t) => ({ ruleId: t.ruleId, result: t.result })) : d.ruleTrace,
    actorType: d.actorType, actorId: d.actorId, reasonCode: d.reasonCode, note: hide ? null : d.note, createdAt: d.createdAt,
    auditor: aud ? { ...aud, officer: undefined } : null,
    masked: hide ? mask : [],
  };
}

