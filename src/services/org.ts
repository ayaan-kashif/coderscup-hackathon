import 'server-only';
/**
 * A6 Organisation (ADM-1, API-2): users and roles in this office, session revocation (AUTH-6), API keys with scopes,
 * hashed storage and revocation. AU3 consent and access logs; break-glass access for auditors (F8).
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { apiKeyHash, hashSecret } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { aiDecisions, apiKeys, auditEvents, cases, citizens, complaints, consents, decisions, memberships, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';

export async function listUsers(db: DbOrTx, tenantId: string) {
  return db.select({ id: users.id, email: users.email, name: users.displayName, role: memberships.role, isSenior: memberships.isSenior, sessionsRevokedAt: users.sessionsRevokedAt, createdAt: users.createdAt })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.tenantId, tenantId)).orderBy(memberships.role, users.displayName);
}

export const newUserBody = z.object({
  email: z.email().refine((e) => e.endsWith('.test'), 'staff use fictional addresses on the reserved .test domain'),
  displayName: z.string().min(3).max(80),
  role: z.enum(['officer', 'admin', 'auditor', 'helper']),
  isSenior: z.boolean().default(false),
});

/** returns a one-time temporary password (shown once, never stored in clear) */
export async function createUser(db: DbOrTx, tenantId: string, b: z.infer<typeof newUserBody>) {
  const temp = `tmp-${randomBytes(9).toString('base64url')}`;
  const [u] = await db.insert(users).values({ kind: 'staff', email: b.email.toLowerCase(), displayName: b.displayName, passwordHash: await hashSecret(temp), locale: 'en' })
    .onConflictDoUpdate({ target: users.email, set: { displayName: b.displayName } }).returning({ id: users.id });
  await db.insert(memberships).values({ userId: u!.id, tenantId, role: b.role, isSenior: b.isSenior })
    .onConflictDoUpdate({ target: [memberships.userId, memberships.tenantId], set: { role: b.role, isSenior: b.isSenior } });
  return { id: u!.id, temporaryPassword: temp };
}

export async function revokeSessions(db: DbOrTx, userId: string) {
  await db.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, userId));
}

export const API_SCOPES = ['cases:read', 'cases:write', 'scam:check'] as const;
export const newKeyBody = z.object({ name: z.string().min(3).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1).max(3), ratePerMinute: z.number().int().min(1).max(600).default(60) });

export async function listKeys(db: DbOrTx, tenantId: string) {
  return db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes, ratePerMinute: apiKeys.ratePerMinute, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys).where(eq(apiKeys.tenantId, tenantId)).orderBy(desc(apiKeys.createdAt));
}

/** API-2: amk_<prefix>_<secret>; only the peppered SHA-256 is stored; the key is shown once */
export async function createKey(db: DbOrTx, tenantId: string, by: string, b: z.infer<typeof newKeyBody>) {
  const prefix = randomBytes(6).toString('hex').slice(0, 8);
  const key = `amk_${prefix}_${randomBytes(24).toString('base64url')}`;
  const [k] = await db.insert(apiKeys).values({ tenantId, name: b.name, prefix, keyHash: apiKeyHash(key), scopes: [...b.scopes], ratePerMinute: b.ratePerMinute, createdBy: by }).returning({ id: apiKeys.id });
  return { id: k!.id, key, prefix };
}

export async function revokeKey(db: DbOrTx, id: string) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
}

// ---------------------------------------------------------------- auditor
export const decisionSearchQuery = z.object({
  caseId: z.uuid().optional(), citizenId: z.uuid().optional(), actor: z.string().max(80).optional(),
  kind: z.enum(['case', 'ai', 'all']).default('all'), aiKind: z.enum(['scam_verdict', 'intent_routing', 'complaint_triage', 'policy_answer', 'second_opinion']).optional(),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** AU1: case decisions and other AI decisions, searched together (EXP-5) */
export async function searchDecisions(db: DbOrTx, tenantId: string, q: z.infer<typeof decisionSearchQuery>) {
  const out: { type: 'case' | 'ai'; id: string; kind: string; outcome: string; createdAt: Date; caseId?: string; actor?: string; inputHash: string; model?: string; gates?: string[] }[] = [];
  if (q.kind !== 'ai') {
    const w = [eq(decisions.tenantId, tenantId)];
    if (q.caseId) w.push(eq(decisions.caseId, q.caseId));
    if (q.citizenId) w.push(eq(cases.citizenId, q.citizenId));
    if (q.actor) w.push(eq(decisions.actorId, q.actor));
    if (q.from) w.push(gt(decisions.createdAt, new Date(q.from)));
    if (q.to) w.push(sql`${decisions.createdAt} <= ${new Date(q.to)}`);
    const rows = await db.select({ d: decisions }).from(decisions).innerJoin(cases, eq(cases.id, decisions.caseId)).where(and(...w)).orderBy(desc(decisions.createdAt)).limit(q.limit);
    for (const { d } of rows) out.push({ type: 'case', id: d.id, kind: d.actorType === 'officer' ? 'officer_decision' : 'case_decision', outcome: d.outcome, createdAt: d.createdAt, caseId: d.caseId, actor: `${d.actorType}:${d.actorId}`, inputHash: d.inputHash, gates: d.gates });
  }
  if (q.kind !== 'case' && !q.caseId && !q.citizenId) {
    const w = [eq(aiDecisions.tenantId, tenantId)];
    if (q.aiKind) w.push(eq(aiDecisions.kind, q.aiKind));
    if (q.from) w.push(gt(aiDecisions.createdAt, new Date(q.from)));
    const rows = await db.select().from(aiDecisions).where(and(...w)).orderBy(desc(aiDecisions.createdAt)).limit(q.limit);
    for (const r of rows) out.push({ type: 'ai', id: r.id, kind: r.kind, outcome: JSON.stringify(r.result).slice(0, 80), createdAt: r.createdAt, inputHash: r.inputHash, model: r.model });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, q.limit);
}

/** AU3: one citizen's consent records and every read of her data, allowed and denied */
export async function consentAndAccess(db: DbOrTx, tenantId: string, citizenId: string) {
  const cons = await db.select().from(consents).where(and(eq(consents.citizenId, citizenId), eq(consents.tenantId, tenantId))).orderBy(desc(consents.createdAt));
  const reads = await db.select({ ts: auditEvents.ts, action: auditEvents.action, actorType: auditEvents.actorType, actorId: auditEvents.actorId, outcome: auditEvents.outcome, details: auditEvents.details })
    .from(auditEvents).where(and(eq(auditEvents.subjectCitizenId, citizenId), or(eq(auditEvents.tenantId, tenantId), isNull(auditEvents.tenantId)))).orderBy(desc(auditEvents.id)).limit(300);
  return { consents: cons, events: reads };
}

export const breakGlassBody = z.object({
  caseId: z.uuid(),
  basis: z.enum(['open_complaint', 'legal_request']),
  complaintId: z.uuid().optional(),
  reason: z.string().min(15).max(500),
});
export const BREAK_GLASS_MINUTES = 30;

/** F8: personal fields for an auditor only with an open complaint or a legal request; 30 minutes; in her access log */
export async function openBreakGlass(db: DbOrTx, tenantId: string, b: z.infer<typeof breakGlassBody>) {
  const [k] = await db.select({ citizenId: cases.citizenId, tenantId: cases.tenantId }).from(cases).where(eq(cases.id, b.caseId)).limit(1);
  if (!k || k.tenantId !== tenantId) throw new ApiError('NOT_FOUND');
  if (b.basis === 'open_complaint') {
    if (!b.complaintId) throw new ApiError('VALIDATION_FAILED', 'Name the open complaint.');
    const [cmp] = await db.select({ id: complaints.id }).from(complaints).where(and(eq(complaints.id, b.complaintId), eq(complaints.caseId, b.caseId), inArray(complaints.status, ['open', 'in_review']))).limit(1);
    if (!cmp) throw new ApiError('VALIDATION_FAILED', 'No open complaint with that id on this case.');
  }
  return { citizenId: k.citizenId, expiresAt: new Date(Date.now() + BREAK_GLASS_MINUTES * 60_000) };
}

export async function activeBreakGlass(db: DbOrTx, auditorId: string, caseId: string) {
  const [e] = await db.select({ ts: auditEvents.ts }).from(auditEvents).where(and(eq(auditEvents.actorId, auditorId), eq(auditEvents.action, 'breakglass.open'), eq(auditEvents.resourceId, caseId), eq(auditEvents.outcome, 'allowed'),
    gt(auditEvents.ts, new Date(Date.now() - BREAK_GLASS_MINUTES * 60_000)))).limit(1);
  return !!e;
}

export async function citizenIdByCase(db: DbOrTx, caseId: string) {
  const [k] = await db.select({ c: cases.citizenId }).from(cases).where(eq(cases.id, caseId)).limit(1);
  const [cz] = k?.c ? await db.select({ name: citizens.nameDisplay }).from(citizens).where(eq(citizens.id, k.c)).limit(1) : [];
  return { citizenId: k?.c ?? null, name: cz?.name ?? null };
}
