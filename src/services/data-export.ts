import 'server-only';
/**
 * CONS-8 (P2): a citizen downloads her own data as JSON — profile, consents, cases with the facts and answers she
 * gave, documents (metadata, not image bytes), payments, complaints, corrections, notifications and the access log.
 * Only her own rows; secrets (PIN hash, OTP hash, encryption blobs) are never included.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { decryptPii } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { caseFacts, cases, citizens, complaints, consents, correctionRequests, decisions, documents, notifications, payments, tenants, users, voiceInputs } from '@/db/schema/all';
import { accessLog } from './consent';

export const EXPORT_VERSION = 'amanat-export@1';

const plainFact = (v: unknown) => {
  if (v && typeof v === 'object' && 'enc' in (v as Record<string, unknown>) && typeof (v as { enc: unknown }).enc === 'string') {
    try { return decryptPii(Buffer.from((v as { enc: string }).enc, 'base64')); } catch { return '[unreadable]'; }
  }
  return v;
};

export async function exportCitizenData(db: DbOrTx, citizenId: string) {
  const [c] = await db.select({
    id: citizens.id, nameDisplay: citizens.nameDisplay, cnicEnc: citizens.cnicEnc, dob: citizens.dob, gender: citizens.gender,
    trustPictureId: citizens.trustPictureId, createdAt: citizens.createdAt, phone: users.phone, locale: users.locale,
  }).from(citizens).leftJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, citizenId)).limit(1);
  if (!c) return null;

  const myCases = await db.select({ id: cases.id, tenant: tenants.name, status: cases.status, channel: cases.channel, createdAt: cases.createdAt, submittedAt: cases.submittedAt, currentDecisionId: cases.currentDecisionId })
    .from(cases).innerJoin(tenants, eq(tenants.id, cases.tenantId)).where(eq(cases.citizenId, citizenId)).orderBy(desc(cases.createdAt));
  const caseIds = myCases.map((x) => x.id);
  const none = caseIds.length === 0;

  const [facts, docs, voice, pays, decs] = await Promise.all([
    none ? [] : db.select({ caseId: caseFacts.caseId, key: caseFacts.key, value: caseFacts.value, createdAt: caseFacts.createdAt, supersededBy: caseFacts.supersededBy }).from(caseFacts).where(inArray(caseFacts.caseId, caseIds)),
    none ? [] : db.select({ caseId: documents.caseId, docType: documents.docType, mime: documents.mime, createdAt: documents.createdAt, imageKept: documents.contentEnc }).from(documents).where(inArray(documents.caseId, caseIds)),
    none ? [] : db.select({ caseId: voiceInputs.caseId, questionKey: voiceInputs.questionKey, transcript: voiceInputs.transcript, status: voiceInputs.status, createdAt: voiceInputs.createdAt }).from(voiceInputs).where(inArray(voiceInputs.caseId, caseIds)),
    none ? [] : db.select({ caseId: payments.caseId, amount: payments.amount, status: payments.status, sentAt: payments.sentAt, confirmedAmount: payments.confirmedAmount }).from(payments).where(inArray(payments.caseId, caseIds)),
    none ? [] : db.select({ id: decisions.id, caseId: decisions.caseId, outcome: decisions.outcome, explanation: decisions.explanationCitizen, createdAt: decisions.createdAt }).from(decisions).where(inArray(decisions.caseId, caseIds)),
  ]);

  const [cons, comps, corrs, notes, log] = await Promise.all([
    db.select({ id: consents.id, tenantId: consents.tenantId, granteeType: consents.granteeType, purpose: consents.purpose, dataCategories: consents.dataCategories, status: consents.status, createdAt: consents.createdAt, withdrawnAt: consents.withdrawnAt, expiresAt: consents.expiresAt }).from(consents).where(eq(consents.citizenId, citizenId)),
    db.select({ caseId: complaints.caseId, type: complaints.type, status: complaints.status, description: complaints.description, createdAt: complaints.createdAt }).from(complaints).where(eq(complaints.citizenId, citizenId)),
    db.select({ caseId: correctionRequests.caseId, fieldKey: correctionRequests.fieldKey, claimedValue: correctionRequests.claimedValue, status: correctionRequests.status, createdAt: correctionRequests.createdAt }).from(correctionRequests).where(eq(correctionRequests.citizenId, citizenId)),
    db.select({ channel: notifications.channel, templateKey: notifications.templateKey, status: notifications.status, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.citizenId, citizenId)).orderBy(desc(notifications.createdAt)).limit(500),
    accessLog(db, citizenId),
  ]);

  const byCase = <T extends { caseId: string | null }>(rows: T[], id: string) => rows.filter((r) => r.caseId === id).map((r) => { const o: Partial<T> = { ...r }; delete o.caseId; return o; });
  return {
    format: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    note: 'Synthetic demo data. This file holds everything AMANAT AI keeps about you. Photos are listed but not included.',
    profile: { name: c.nameDisplay, cnic: decryptPii(c.cnicEnc), dob: c.dob, gender: c.gender, phone: c.phone, language: c.locale, trustPictureId: c.trustPictureId, since: c.createdAt },
    consents: cons,
    cases: myCases.map((k) => ({
      ...k,
      facts: byCase(facts, k.id).filter((f) => !f.supersededBy).map((f) => ({ key: f.key, value: plainFact(f.value), at: f.createdAt })),
      documents: byCase(docs, k.id).map((d) => ({ type: d.docType, mime: d.mime, at: d.createdAt, imageStillKept: !!d.imageKept })),
      voiceAnswers: byCase(voice, k.id),
      decisions: byCase(decs.map((d) => ({ ...d, caseId: d.caseId })), k.id),
      payments: byCase(pays, k.id),
    })),
    complaints: comps,
    corrections: corrs,
    notifications: notes,
    accessLog: log,
  };
}
