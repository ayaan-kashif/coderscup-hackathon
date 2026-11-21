import 'server-only';
/**
 * F17 / CMP-1..3 / PAY-5 / CIT-10..11: complaints (with Jev triage that can only RAISE the rule minimum), the
 * exact-amount receipt, and citizen correction requests reviewed in the same officer queue.
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '@/auth/actor';
import { decryptPii } from '@/auth/crypto';
import { triageComplaint } from '@/ai/jev';
import { recordAiDecision } from '@/ai/calls';
import type { DbOrTx } from '@/db/client';
import { auditEvents, cases, citizens, complaints, correctionRequests, districts, helperGrants, payments, payoutDestinations, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { complaintSystem, paymentLedger } from './adapters';
import { caseTimeline } from './intake';
import { factCandidates, putFact } from './pipeline/data';

export const COMPLAINT_TYPES = ['deduction', 'misconduct', 'scam', 'data_issue', 'payout_objection', 'other'] as const;

/** rule-based minimum severity (0–3); Jev may raise it, never lower it */
export function minimumSeverity(type: string, amountMissing: number | null) {
  if (type === 'deduction' && amountMissing) return 3; // "received less" with a missing amount is always high
  if (type === 'payout_objection' || type === 'misconduct') return 2;
  if (type === 'scam') return 2;
  return 1;
}

/** which helper acted on this case (under a grant), for linking complaints (CIT-11) */
export async function helperOnCase(db: DbOrTx, caseId: string | null, citizenId: string | null) {
  if (caseId) {
    const [r] = await db.select({ actorId: auditEvents.actorId }).from(auditEvents)
      .where(and(eq(auditEvents.resourceId, caseId), sql`${auditEvents.details}->>'via' = 'helper'`)).orderBy(desc(auditEvents.id)).limit(1);
    if (r) return r.actorId;
  }
  if (citizenId) {
    const [g] = await db.select({ helper: helperGrants.helperUserId }).from(helperGrants).where(eq(helperGrants.citizenId, citizenId)).orderBy(desc(helperGrants.createdAt)).limit(1);
    if (g) return g.helper;
  }
  return null;
}

export const complaintBody = z.object({
  type: z.enum(COMPLAINT_TYPES),
  caseId: z.uuid().optional(),
  paymentId: z.uuid().optional(),
  amountMissing: z.number().int().positive().max(1_000_000).optional(),
  description: z.string().max(500).optional(),
  citizenId: z.uuid().optional(),
});

export async function createComplaint(db: DbOrTx, actor: Actor, tenantId: string, b: Omit<z.infer<typeof complaintBody>, 'citizenId'> & { citizenId: string | null; channel: string }) {
  const helperUserId = await helperOnCase(db, b.caseId ?? null, b.citizenId);
  const min = minimumSeverity(b.type, b.amountMissing ?? null);
  const triage = await triageComplaint(db, tenantId, { type: b.type, amountMissing: b.amountMissing ?? null, summary: (b.description ?? '').slice(0, 300) });
  const severity = triage.ok ? Math.max(min, Math.min(3, triage.value.severity)) : min;
  let externalRef: string | null = null;
  try { externalRef = (await complaintSystem.file({ type: b.type, caseRef: b.caseId, summary: `${b.type}${b.amountMissing ? ` Rs ${b.amountMissing} missing` : ''}` })).data?.ref ?? null; } catch { /* the mock complaint system being down never loses the complaint */ }
  const [row] = await db.insert(complaints).values({
    tenantId, caseId: b.caseId ?? null, paymentId: b.paymentId ?? null, citizenId: b.citizenId, type: b.type, amountMissing: b.amountMissing ?? null,
    helperUserId: helperUserId && /^[0-9a-f-]{36}$/i.test(helperUserId) ? helperUserId : null, channel: b.channel, severity, description: b.description ?? null, externalRef,
  }).returning();
  await recordAiDecision(db, {
    tenantId, kind: 'complaint_triage', input: { type: b.type, amountMissing: b.amountMissing ?? null, description: b.description ?? '' }, model: triage.model,
    probabilities: triage.ok ? triage.probabilities : null, result: { severity, ruleMinimum: min, modelSeverity: triage.ok ? triage.value.severity : null, complaintId: row!.id },
    userReason: triage.ok ? `Severity ${severity}: the rule minimum is ${min}; the model can only raise it.` : `Severity ${severity} from the rules (model unavailable: ${triage.ok ? '' : triage.reason}).`,
  });
  return row!;
}

/** CIT-10 / PAY-5: "received all" or "received less" (the missing amount, linked to payment and helper) */
export const receiptBody = z.object({ received: z.enum(['all', 'less']), amountReceived: z.number().int().min(0).max(1_000_000).optional() })
  .refine((v) => v.received === 'all' || typeof v.amountReceived === 'number', 'say how much you received');

export async function recordReceipt(db: DbOrTx, actor: Actor, paymentId: string, b: z.infer<typeof receiptBody>) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
  if (!p) throw new ApiError('NOT_FOUND');
  if (!['sent', 'confirmed_full'].includes(p.status)) throw new ApiError('CASE_STATE', 'This payment has not been sent yet.');
  // "received less" after "all" is allowed within 7 days (§27.3)
  if (p.status === 'confirmed_full' && (b.received === 'all' || Date.now() - (p.confirmedAt?.getTime() ?? 0) > 7 * 86_400_000)) throw new ApiError('CASE_STATE', 'This receipt is already confirmed.');
  const [c] = await db.select({ id: cases.id, citizenId: cases.citizenId, tenantId: cases.tenantId }).from(cases).where(eq(cases.id, p.caseId)).limit(1);
  if (b.received === 'all') {
    await db.update(payments).set({ status: 'confirmed_full', confirmedAmount: p.amount, confirmedAt: new Date() }).where(eq(payments.id, p.id));
    await db.update(cases).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(cases.id, p.caseId));
    return { status: 'confirmed_full' as const, complaint: null };
  }
  const got = Math.min(b.amountReceived!, p.amount);
  const missing = p.amount - got;
  if (missing <= 0) throw new ApiError('VALIDATION_FAILED', 'That is the full amount; tap "received all".');
  await db.update(payments).set({ status: 'disputed', confirmedAmount: got, confirmedAt: new Date() }).where(eq(payments.id, p.id));
  await db.update(cases).set({ status: 'disputed', updatedAt: new Date() }).where(eq(cases.id, p.caseId));
  const complaint = await createComplaint(db, actor, c!.tenantId, { type: 'deduction', caseId: c!.id, paymentId: p.id, amountMissing: missing, citizenId: c!.citizenId, channel: 'receipt_received_less', description: `Received Rs ${got} of Rs ${p.amount}` });
  return { status: 'disputed' as const, complaint: { id: complaint.id, severity: complaint.severity, amountMissing: missing, helperLinked: !!complaint.helperUserId } };
}

export const complaintQuery = z.object({ type: z.enum(COMPLAINT_TYPES).optional(), district: z.string().max(8).optional(), helper: z.uuid().optional(), status: z.enum(['open', 'resolved', 'all']).optional() });

/** CMP-1: severity, then age; filters by type, district, helper */
export async function listComplaints(db: DbOrTx, tenantId: string, q: z.infer<typeof complaintQuery>) {
  const rows = await db.select({ c: complaints, district: districts.code, helperName: users.displayName }).from(complaints)
    .leftJoin(citizens, eq(citizens.id, complaints.citizenId)).leftJoin(districts, eq(districts.id, citizens.districtId)).leftJoin(users, eq(users.id, complaints.helperUserId))
    .where(and(eq(complaints.tenantId, tenantId), q.status === 'all' ? sql`true` : q.status === 'resolved' ? eq(complaints.status, 'resolved') : inArray(complaints.status, ['open', 'in_review'])))
    .orderBy(desc(complaints.severity), asc(complaints.createdAt)).limit(200);
  const helperCounts = await db.select({ helper: complaints.helperUserId, n: count() }).from(complaints).where(eq(complaints.tenantId, tenantId)).groupBy(complaints.helperUserId);
  return rows.filter((r) => (!q.type || r.c.type === q.type) && (!q.district || r.district === q.district) && (!q.helper || r.c.helperUserId === q.helper))
    .map((r) => ({ id: r.c.id, type: r.c.type, severity: r.c.severity, status: r.c.status, amountMissing: r.c.amountMissing, caseId: r.c.caseId, paymentId: r.c.paymentId, district: r.district, helperUserId: r.c.helperUserId, helperName: r.helperName, helperComplaints: helperCounts.find((h) => h.helper === r.c.helperUserId)?.n ?? 0, channel: r.c.channel, externalRef: r.c.externalRef, createdAt: r.c.createdAt, resolution: r.c.resolution }));
}

/** CMP-2: linked payment, ledger entry, case timeline, helper actions under that unlock, earlier complaints against the helper */
export async function complaintView(db: DbOrTx, id: string) {
  const [c] = await db.select().from(complaints).where(eq(complaints.id, id)).limit(1);
  if (!c) return null;
  const [p] = c.paymentId ? await db.select().from(payments).where(eq(payments.id, c.paymentId)).limit(1) : [];
  let ledger: unknown = null;
  if (p?.ledgerRef && c.citizenId) {
    const [cz] = await db.select({ cnicEnc: citizens.cnicEnc }).from(citizens).where(eq(citizens.id, c.citizenId)).limit(1);
    try { ledger = ((await paymentLedger.list({ cnic: decryptPii(cz!.cnicEnc) })).data?.payments ?? []).find((x) => x.ref === p.ledgerRef) ?? null; } catch { ledger = { unavailable: true }; }
  }
  const helperActions = c.helperUserId && c.caseId ? await db.select({ ts: auditEvents.ts, action: auditEvents.action, details: auditEvents.details }).from(auditEvents)
    .where(and(eq(auditEvents.actorId, c.helperUserId), eq(auditEvents.resourceId, c.caseId))).orderBy(desc(auditEvents.id)).limit(50) : [];
  const earlier = c.helperUserId ? await db.select({ id: complaints.id, type: complaints.type, resolution: complaints.resolution, createdAt: complaints.createdAt }).from(complaints)
    .where(and(eq(complaints.helperUserId, c.helperUserId), sql`${complaints.id} <> ${c.id}`)).orderBy(desc(complaints.createdAt)).limit(20) : [];
  const [dest] = p?.destinationId ? await db.select({ last4: payoutDestinations.walletLast4 }).from(payoutDestinations).where(eq(payoutDestinations.id, p.destinationId)).limit(1) : [];
  return {
    complaint: c,
    payment: p ? { id: p.id, amount: p.amount, status: p.status, ledgerRef: p.ledgerRef, sentAt: p.sentAt, confirmedAmount: p.confirmedAmount, walletLast4: dest?.last4 ?? null } : null,
    ledgerEntry: ledger, timeline: c.caseId ? await caseTimeline(db, c.caseId, 'staff') : [], helperActions, earlierHelperComplaints: earlier,
  };
}

export const resolveBody = z.object({
  resolution: z.enum(['upheld', 'not_upheld', 'referred']),
  reasonCode: z.enum(['deduction_confirmed', 'helper_misconduct', 'ledger_matches_full_amount', 'insufficient_evidence', 'referred_to_police', 'referred_to_programme', 'payout_change_fraud', 'resolved_with_citizen']),
  note: z.string().min(5).max(500),
});

export async function resolveComplaint(db: DbOrTx, id: string, officerId: string, b: z.infer<typeof resolveBody>) {
  const [c] = await db.select().from(complaints).where(eq(complaints.id, id)).for('update').limit(1);
  if (!c) throw new ApiError('NOT_FOUND');
  if (c.status === 'resolved') throw new ApiError('CASE_STATE', 'Already resolved.');
  await db.update(complaints).set({ status: 'resolved', resolution: b.resolution, reasonCode: b.reasonCode, note: b.note, resolvedBy: officerId, resolvedAt: new Date() }).where(eq(complaints.id, id));
  return c;
}

// ---------------------------------------------------------------- corrections (CONS-7, CMP-3)
export const CORRECTABLE = ['applicant.name', 'applicant.dob', 'spouse.name', 'spouse.date_of_death', 'household.monthly_income', 'applicant.remarried', 'applicant.district'] as const;
export const correctionBody = z.object({ caseId: z.uuid(), fieldKey: z.enum(CORRECTABLE), claimedValue: z.union([z.string().max(120), z.number(), z.boolean()]) });

export async function requestCorrection(db: DbOrTx, citizenId: string, b: z.infer<typeof correctionBody>) {
  const [c] = await db.select({ tenantId: cases.tenantId, citizenId: cases.citizenId }).from(cases).where(eq(cases.id, b.caseId)).limit(1);
  if (!c || c.citizenId !== citizenId) throw new ApiError('NOT_FOUND');
  const facts = await factCandidates(db, b.caseId);
  const old = facts[b.fieldKey]?.[0]?.value ?? null;
  const [row] = await db.insert(correctionRequests).values({ citizenId, tenantId: c.tenantId, caseId: b.caseId, fieldKey: b.fieldKey, claimedValue: b.claimedValue as never, oldValue: old as never }).returning();
  return row!;
}

export async function listCorrections(db: DbOrTx, tenantId: string) {
  return db.select().from(correctionRequests).where(and(eq(correctionRequests.tenantId, tenantId), eq(correctionRequests.status, 'open'))).orderBy(asc(correctionRequests.createdAt)).limit(100);
}

export const correctionDecisionBody = z.object({ reasonCode: z.enum(['document_supports_claim', 'registry_confirms', 'no_evidence', 'contradicts_registry']), note: z.string().max(500).optional() });

/** approved → a new fact with source = officer (old value kept), and the case is re-decided */
export async function decideCorrection(db: DbOrTx, id: string, officerId: string, approve: boolean, b: z.infer<typeof correctionDecisionBody>) {
  const [r] = await db.select().from(correctionRequests).where(eq(correctionRequests.id, id)).for('update').limit(1);
  if (!r) throw new ApiError('NOT_FOUND');
  if (r.status !== 'open') throw new ApiError('CASE_STATE', `Already ${r.status}.`);
  await db.update(correctionRequests).set({ status: approve ? 'approved' : 'rejected', reviewedBy: officerId, reviewedAt: new Date(), reasonCode: b.reasonCode, note: b.note ?? null }).where(eq(correctionRequests.id, id));
  let redecide = false;
  if (approve && r.caseId) {
    await putFact(db, { caseId: r.caseId, tenantId: r.tenantId, key: r.fieldKey, value: r.claimedValue, source: 'officer', ref: `correction:${r.id}`, by: `officer:${officerId}` });
    const res = await db.update(cases).set({ status: 'submitted', updatedAt: new Date() }).where(and(eq(cases.id, r.caseId), inArray(cases.status, ['in_review', 'needs_proof', 'approved_on_hold']))).returning({ id: cases.id });
    redecide = res.length > 0;
  }
  return { request: r, redecide };
}

