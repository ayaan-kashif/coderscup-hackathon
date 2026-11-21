/**
 * Resource loaders for authorization: only tenant and citizen ids, never personal data before the verdict.
 * An unknown id returns null → 404 identical to another tenant's resource (TEN-2).
 */
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { aiDecisions, apiKeys, cases, evalRuns, memberships, ruleSets, twinRuns, complaints, consents, correctionRequests, decisions, payments, payoutChanges, scamAlerts, scamReports } from '@/db/schema/all';
import type { LoadedResource } from '@/lib/api/route';

const UUID = /^[0-9a-f-]{36}$/i;

export async function loadPaymentRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: payments.id, tenantId: payments.tenantId, citizenId: cases.citizenId, caseId: payments.caseId }).from(payments).innerJoin(cases, eq(cases.id, payments.caseId)).where(eq(payments.id, id)).limit(1);
  return r ?? null;
}
export async function loadComplaintRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: complaints.id, tenantId: complaints.tenantId, citizenId: complaints.citizenId }).from(complaints).where(eq(complaints.id, id)).limit(1);
  return r ?? null;
}
export async function loadCorrectionRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: correctionRequests.id, tenantId: correctionRequests.tenantId, citizenId: correctionRequests.citizenId }).from(correctionRequests).where(eq(correctionRequests.id, id)).limit(1);
  return r ?? null;
}
export async function loadPayoutChangeRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: payoutChanges.id, tenantId: payoutChanges.tenantId, citizenId: payoutChanges.citizenId }).from(payoutChanges).where(eq(payoutChanges.id, id)).limit(1);
  return r ?? null;
}
export async function loadDecisionRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: decisions.id, tenantId: decisions.tenantId, citizenId: cases.citizenId, caseId: decisions.caseId }).from(decisions).innerJoin(cases, eq(cases.id, decisions.caseId)).where(eq(decisions.id, id)).limit(1);
  return r ?? null;
}
export async function loadAlertRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: scamAlerts.id, tenantId: scamAlerts.tenantId }).from(scamAlerts).where(eq(scamAlerts.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadScamReportRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: scamReports.id, tenantId: scamReports.tenantId }).from(scamReports).where(eq(scamReports.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadAiDecisionRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: aiDecisions.id, tenantId: aiDecisions.tenantId }).from(aiDecisions).where(eq(aiDecisions.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadConsentRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: consents.id, citizenId: consents.citizenId }).from(consents).where(eq(consents.id, id)).limit(1);
  return r ? { ...r, tenantId: null } : null;
}

export async function loadRuleSetRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: ruleSets.id, tenantId: ruleSets.tenantId }).from(ruleSets).where(eq(ruleSets.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadTwinRunRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: twinRuns.id, tenantId: twinRuns.tenantId }).from(twinRuns).where(eq(twinRuns.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadEvalRunRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: evalRuns.id, tenantId: evalRuns.tenantId }).from(evalRuns).where(eq(evalRuns.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
/** a staff user's membership — the caller's office first, so the policy decides role first, then tenant (404) */
export async function loadUserRef(db: DbOrTx, id: string, tenantId: string | undefined): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: memberships.userId, tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.userId, id))
    .orderBy(sql`case when ${memberships.tenantId} = ${tenantId ?? null} then 0 else 1 end`).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
export async function loadApiKeyRef(db: DbOrTx, id: string): Promise<LoadedResource | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select({ id: apiKeys.id, tenantId: apiKeys.tenantId }).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  return r ? { ...r, citizenId: null } : null;
}
