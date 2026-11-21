import 'server-only';
/**
 * F8 Consent Control Center: who holds or processes her data, for what and until when (CONS-1); her access log
 * (CONS-2); grant, narrow and withdraw by voice + PIN (CONS-3/4). Withdrawal pauses her cases, revokes helper
 * grants and holds pending payments; every later staff read returns 403 CONSENT_WITHDRAWN (enforced in policy).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { auditEvents, cases, consents, helperAssignments, helperGrants, memberships, payments, tenants, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { CONSENT_NOTICE_VERSION, ELIGIBILITY_CATEGORIES } from './seed/core';

/** processors named in plain words (CONS-1); all registries and model providers here are SIMULATED or prototype */
export const PROCESSORS = [
  { id: 'mock-identity', en: 'Identity registry (simulated)', ur: 'شناختی ریکارڈ (فرضی)', purpose: 'Check your identity card details', simulated: true },
  { id: 'mock-civil', en: 'Civil registry (simulated)', ur: 'سول رجسٹری (فرضی)', purpose: 'Check marriage and death records', simulated: true },
  { id: 'mock-ledger', en: 'Payment ledger (simulated)', ur: 'ادائیگی کا کھاتہ (فرضی)', purpose: 'Send and check payments', simulated: true },
  { id: 'ai-gateway', en: 'AI services via Vercel AI Gateway (Google Gemini, TypeSafe Jev, ElevenLabs)', ur: 'اے آئی خدمات', purpose: 'Read documents, understand voice, flag cases for a person. They never decide.', simulated: false },
];

export async function listConsents(db: DbOrTx, citizenId: string) {
  const rows = await db.select({ c: consents, tenantName: tenants.name, tenantNameUr: tenants.nameUr }).from(consents).leftJoin(tenants, eq(tenants.id, consents.tenantId))
    .where(eq(consents.citizenId, citizenId)).orderBy(desc(consents.createdAt));
  const helpers = await db.select({ id: helperAssignments.id, helperId: helperAssignments.helperUserId, name: users.displayName, status: helperAssignments.status, expiresAt: helperAssignments.expiresAt })
    .from(helperAssignments).leftJoin(users, eq(users.id, helperAssignments.helperUserId)).where(and(eq(helperAssignments.citizenId, citizenId), eq(helperAssignments.status, 'active')));
  return {
    consents: rows.map((r) => ({ id: r.c.id, tenantId: r.c.tenantId, grantee: r.c.granteeType === 'tenant' ? { type: 'office', name: r.tenantName, nameUr: r.tenantNameUr } : { type: 'helper', id: r.c.granteeId }, purpose: r.c.purpose, dataCategories: r.c.dataCategories, status: r.c.status, method: r.c.method, noticeVersion: r.c.noticeVersion, expiresAt: r.c.expiresAt, withdrawnAt: r.c.withdrawnAt, createdAt: r.c.createdAt })),
    helpers: helpers.map((h) => ({ assignmentId: h.id, name: h.name, status: h.status, expiresAt: h.expiresAt })),
    processors: PROCESSORS,
  };
}

export const grantBody = z.object({
  tenantId: z.uuid(),
  dataCategories: z.array(z.enum(['case', 'identity', 'documents', 'payments'])).min(1).max(4).default([...ELIGIBILITY_CATEGORIES] as never),
  pin: z.string().regex(/^\d{4}$/),
});

/** grant or narrow (a narrower grant replaces the active row; the old one stays in history as withdrawn) */
export async function grantConsent(db: DbOrTx, citizenId: string, b: z.infer<typeof grantBody>) {
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, b.tenantId)).limit(1);
  if (!t) throw new ApiError('VALIDATION_FAILED', 'Unknown office.');
  await db.update(consents).set({ status: 'withdrawn', withdrawnAt: new Date() }).where(and(eq(consents.citizenId, citizenId), eq(consents.granteeId, b.tenantId), eq(consents.purpose, 'eligibility_verification'), eq(consents.status, 'active')));
  const [row] = await db.insert(consents).values({ citizenId, tenantId: b.tenantId, granteeType: 'tenant', granteeId: b.tenantId, purpose: 'eligibility_verification', dataCategories: b.dataCategories, method: 'voice_pin', noticeVersion: CONSENT_NOTICE_VERSION }).returning();
  // a case paused for consent resumes into review (a person looks again; nothing is auto-approved on resume)
  const resumed = await db.update(cases).set({ status: 'in_review', updatedAt: new Date() }).where(and(eq(cases.citizenId, citizenId), eq(cases.tenantId, b.tenantId), eq(cases.status, 'paused_for_consent'))).returning({ id: cases.id });
  return { consent: row!, resumed: resumed.map((r) => r.id) };
}

export const withdrawBody = z.object({ pin: z.string().regex(/^\d{4}$/), heardWarning: z.literal(true) });

export async function withdrawConsent(db: DbOrTx, citizenId: string, consentId: string) {
  const [c] = await db.select().from(consents).where(eq(consents.id, consentId)).for('update').limit(1);
  if (!c || c.citizenId !== citizenId) throw new ApiError('NOT_FOUND');
  if (c.status !== 'active') throw new ApiError('CASE_STATE', 'Already stopped.');
  await db.update(consents).set({ status: 'withdrawn', withdrawnAt: new Date() }).where(eq(consents.id, consentId));
  const paused = await db.update(cases).set({ status: 'paused_for_consent', updatedAt: new Date() })
    .where(and(eq(cases.citizenId, citizenId), eq(cases.tenantId, c.tenantId), sql`${cases.status} not in ('closed', 'rejected', 'paid', 'confirmed', 'draft')`)).returning({ id: cases.id });
  const revoked = await db.update(helperGrants).set({ revokedAt: new Date() }).where(and(eq(helperGrants.citizenId, citizenId), isNull(helperGrants.revokedAt))).returning({ id: helperGrants.id });
  const held = paused.length ? await db.update(payments).set({ status: 'hold' }).where(and(inArray(payments.caseId, paused.map((p) => p.id)), eq(payments.status, 'scheduled'))).returning({ id: payments.id }) : [];
  return { consent: c, pausedCases: paused.map((p) => p.id), revokedGrants: revoked.length, heldPayments: held.length };
}

const READ_ACTIONS: Record<string, { en: string; ur: string }> = {
  'case.read': { en: 'opened your application', ur: 'نے آپ کی درخواست کھولی' },
  'case.documents.read': { en: 'opened your documents', ur: 'نے آپ کی دستاویزات کھولیں' },
  'case.timeline': { en: 'read your case history', ur: 'نے آپ کے کیس کی تاریخ دیکھی' },
  'case.explanation': { en: 'read the reasons for your decision', ur: 'نے آپ کے فیصلے کی وجوہات دیکھیں' },
  'case.decide': { en: 'made a decision on your application', ur: 'نے آپ کی درخواست پر فیصلہ کیا' },
  'case.answers': { en: 'answered questions for you', ur: 'نے آپ کے لیے جواب دیے' },
  'helper.unlock': { en: 'unlocked your family on a helper phone', ur: 'نے مددگار فون پر آپ کا خاندان کھولا' },
  'complaint.read': { en: 'read your complaint', ur: 'نے آپ کی شکایت دیکھی' },
  'decision.read': { en: 'read a decision on your case', ur: 'نے آپ کے کیس کا فیصلہ دیکھا' },
  'tool.identity.search': { en: 'checked the identity registry (simulated)', ur: 'نے شناختی ریکارڈ چیک کیا' },
  'tool.civil.lookup': { en: 'checked the civil registry (simulated)', ur: 'نے سول رجسٹری چیک کی' },
};

/** CONS-2: "Officer Imran, Badin office, opened your documents yesterday" — allowed AND denied attempts */
export async function accessLog(db: DbOrTx, citizenId: string) {
  const rows = await db.select({ ts: auditEvents.ts, action: auditEvents.action, actorType: auditEvents.actorType, actorId: auditEvents.actorId, outcome: auditEvents.outcome, tenantId: auditEvents.tenantId, details: auditEvents.details })
    .from(auditEvents).where(and(eq(auditEvents.subjectCitizenId, citizenId), inArray(auditEvents.action, Object.keys(READ_ACTIONS)))).orderBy(desc(auditEvents.id)).limit(100);
  const ids = [...new Set(rows.filter((r) => r.actorType === 'user' && /^[0-9a-f-]{36}$/i.test(r.actorId)).map((r) => r.actorId))];
  const people = ids.length ? await db.select({ id: users.id, name: users.displayName, kind: users.kind }).from(users).where(inArray(users.id, ids)) : [];
  const offices = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const roles = ids.length ? await db.select({ userId: memberships.userId, role: memberships.role }).from(memberships).where(inArray(memberships.userId, ids)) : [];
  return rows.map((r) => {
    const who = people.find((p) => p.id === r.actorId);
    const role = roles.find((x) => x.userId === r.actorId)?.role;
    const office = offices.find((o) => o.id === r.tenantId)?.name ?? null;
    const what = READ_ACTIONS[r.action]!;
    const name = who?.kind === 'citizen' ? 'You' : who?.name ?? (r.actorType === 'agent' ? 'The verification system' : r.actorType === 'system' ? 'The system' : 'Someone');
    return {
      ts: r.ts, outcome: r.outcome, role: role ?? r.actorType, actor: name, office,
      en: `${name}${office && who?.kind !== 'citizen' ? `, ${office},` : ''} ${r.outcome === 'denied' ? `tried to ${what.en.replace(/^(opened|read|made|answered|unlocked|checked)/, (m) => ({ opened: 'open', read: 'read', made: 'make', answered: 'answer', unlocked: 'unlock', checked: 'check' })[m] ?? m)} — refused, because you stopped sharing` : what.en}`,
      ur: `${name} ${r.outcome === 'denied' ? '— انکار کیا گیا' : what.ur}`,
      code: r.outcome === 'denied' ? (r.details as { code?: string }).code ?? 'DENIED' : null,
    };
  });
}
