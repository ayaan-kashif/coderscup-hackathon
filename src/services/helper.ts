import 'server-only';
import { requireCategory } from './consent';
/**
 * F10 Helper Mode: up to 40 families as avatar cards (never trust pictures); a family unlocks with its OWN PIN for
 * 30 idle minutes or 2 hours; switching families locks the previous one; helpers never see a full CNIC and cannot
 * change payout or consent. Every action is logged under the helper, the family and the unlock.
 */
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { GRANT_IDLE_MINUTES } from '@/auth/policy-deps';
import type { DbOrTx } from '@/db/client';
import { auditEvents, cases, citizens, helperAssignments, helperGrants, users } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';
import { ticksFor } from './cases';
import { citizenFacingStatus, matchPin } from './duress';

export const GRANT_HOURS = 2;
export const GRANT_SCOPE = ['answer', 'photo', 'submit'];
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MINUTES = 15;

export async function helperFamilies(db: DbOrTx, helperUserId: string) {
  const rows = await db.select({ assignmentId: helperAssignments.id, citizenId: citizens.id, name: citizens.nameDisplay, avatarId: citizens.avatarId, cnicLast4: citizens.cnicLast4, expiresAt: helperAssignments.expiresAt })
    .from(helperAssignments).innerJoin(citizens, eq(citizens.id, helperAssignments.citizenId))
    .where(and(eq(helperAssignments.helperUserId, helperUserId), eq(helperAssignments.status, 'active'), gt(helperAssignments.expiresAt, sql`now()`))).orderBy(citizens.nameDisplay).limit(40);
  const ids = rows.map((r) => r.citizenId);
  const caseRows = ids.length ? await db.select({ id: cases.id, citizenId: cases.citizenId, status: cases.status, firstOpenedAt: cases.firstOpenedAt, frozenReason: cases.frozenReason, updatedAt: cases.updatedAt })
    .from(cases).where(inArray(cases.citizenId, ids)).orderBy(desc(cases.updatedAt)) : [];
  const live = await liveGrant(db, helperUserId);
  return {
    families: rows.map((r) => {
      const c = caseRows.find((k) => k.citizenId === r.citizenId);
      return { citizenId: r.citizenId, name: r.name, avatarId: r.avatarId, cnic: `XXXXX-XXXX${r.cnicLast4.slice(0, 3)}-${r.cnicLast4.slice(3)}`, case: c ? { id: c.id, status: citizenFacingStatus(c.status, c.frozenReason), ticks: ticksFor(c), flagged: citizenFacingStatus(c.status, c.frozenReason) === 'frozen' } : null };
    }),
    unlocked: live ? { grantId: live.id, citizenId: live.citizenId, expiresAt: live.expiresAt, idleExpiresAt: new Date(live.lastActivityAt.getTime() + GRANT_IDLE_MINUTES * 60_000) } : null,
  };
}

export async function liveGrant(db: DbOrTx, helperUserId: string) {
  const [g] = await db.select().from(helperGrants).where(and(eq(helperGrants.helperUserId, helperUserId), isNull(helperGrants.revokedAt), gt(helperGrants.expiresAt, sql`now()`),
    gt(helperGrants.lastActivityAt, sql`now() - make_interval(mins => ${GRANT_IDLE_MINUTES})`))).orderBy(desc(helperGrants.createdAt)).limit(1);
  return g ?? null;
}

/** HELP-2: the family's own PIN (counted toward that family's lockout) → a 2-hour, 30-idle-minute grant */
export async function unlockFamily(db: DbOrTx, helperUserId: string, citizenId: string, pin: string, deviceId?: string) {
  const [a] = await db.select().from(helperAssignments).where(and(eq(helperAssignments.helperUserId, helperUserId), eq(helperAssignments.citizenId, citizenId), eq(helperAssignments.status, 'active'), gt(helperAssignments.expiresAt, sql`now()`))).limit(1);
  if (!a) throw new ApiError('NOT_FOUND');
  // CONS-4: a family that stopped sharing with the office cannot be unlocked again until she shares again
  await requireCategory(db, citizenId, a.tenantId, 'case', 'application');
  const [c] = await db.select().from(citizens).where(eq(citizens.id, citizenId)).for('update').limit(1);
  if (!c?.pinHash) throw new ApiError('VALIDATION_FAILED', 'This family has not set a PIN yet; send a code to their phone instead.');
  if (c.pinLockedUntil && c.pinLockedUntil.getTime() > Date.now()) return { ok: false as const, locked: true, left: 0 };
  const match = await matchPin(db, { id: c.id, pinHash: c.pinHash, duressPinHash: c.duressPinHash }, pin);
  if (match === 'wrong') {
    const tries = c.pinFailedAttempts + 1;
    if (tries >= PIN_MAX_TRIES) {
      await db.update(citizens).set({ pinFailedAttempts: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) }).where(eq(citizens.id, c.id));
      return { ok: false as const, locked: true, left: 0 };
    }
    await db.update(citizens).set({ pinFailedAttempts: tries }).where(eq(citizens.id, c.id));
    return { ok: false as const, locked: false, left: PIN_MAX_TRIES - tries };
  }
  await db.update(citizens).set({ pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(citizens.id, c.id));
  // HELP-3: switching families locks the previous one
  const switched = await db.update(helperGrants).set({ revokedAt: new Date() }).where(and(eq(helperGrants.helperUserId, helperUserId), isNull(helperGrants.revokedAt))).returning({ id: helperGrants.id, citizenId: helperGrants.citizenId });
  // Silent Duress PIN: the family typed its PIN backwards in front of the helper. The grant is created (so the reply
  // looks like any unlock) but born revoked, and the caller runs the lockdown.
  const duress = match === 'duress';
  const [g] = await db.insert(helperGrants).values({ assignmentId: a.id, helperUserId, citizenId, scope: GRANT_SCOPE, method: 'pin', deviceId: deviceId ?? null, expiresAt: new Date(Date.now() + GRANT_HOURS * 3_600_000), revokedAt: duress ? new Date() : null }).returning();
  // the unlocks this helper held on this family just before the duress entry are evidence too
  const quarantined = duress ? [g!.id, ...switched.filter((x) => x.citizenId === citizenId).map((x) => x.id)] : [];
  return { ok: true as const, grant: g!, family: { name: c.nameDisplay, avatarId: c.avatarId }, duress, quarantined };
}

export async function lockGrant(db: DbOrTx, helperUserId: string, grantId: string) {
  const r = await db.update(helperGrants).set({ revokedAt: new Date() }).where(and(eq(helperGrants.id, grantId), eq(helperGrants.helperUserId, helperUserId), isNull(helperGrants.revokedAt))).returning({ id: helperGrants.id, citizenId: helperGrants.citizenId });
  if (!r.length) throw new ApiError('NOT_FOUND');
  return r[0]!;
}

/** every helper action under a grant refreshes the 30-minute idle timer */
export async function touchGrant(db: DbOrTx, helperUserId: string, citizenId: string) {
  const [g] = await db.update(helperGrants).set({ lastActivityAt: new Date() }).where(and(eq(helperGrants.helperUserId, helperUserId), eq(helperGrants.citizenId, citizenId), isNull(helperGrants.revokedAt))).returning({ id: helperGrants.id });
  return g?.id ?? null;
}

/** H4: the helper's own actions, with family and unlock id */
export async function helperActivity(db: DbOrTx, helperUserId: string) {
  const rows = await db.select({ ts: auditEvents.ts, action: auditEvents.action, resourceType: auditEvents.resourceType, resourceId: auditEvents.resourceId, subject: auditEvents.subjectCitizenId, outcome: auditEvents.outcome, details: auditEvents.details })
    .from(auditEvents).where(eq(auditEvents.actorId, helperUserId)).orderBy(desc(auditEvents.id)).limit(200);
  const ids = [...new Set(rows.map((r) => r.subject).filter(Boolean) as string[])];
  const names = ids.length ? await db.select({ id: citizens.id, name: citizens.nameDisplay, avatarId: citizens.avatarId }).from(citizens).where(inArray(citizens.id, ids)) : [];
  return rows.map((r) => ({ ts: r.ts, action: r.action, outcome: r.outcome, caseId: r.resourceType === 'case' ? r.resourceId : null, family: names.find((n) => n.id === r.subject) ?? null, grantId: (r.details as { grantId?: string }).grantId ?? null }));
}

export async function helperName(db: DbOrTx, id: string) {
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.name ?? null;
}
