import 'server-only';
/**
 * Silent Duress PIN (coercion-safe mode).
 *
 * A citizen whose real PIN is 4525 can enter it backwards (5254) when someone is standing over her. The screen
 * behaves exactly as for the real PIN; in the same transaction the server:
 *   1. shadow-freezes her open cases (payments on hold) and holds any pending payout-number change (`duress_hold`),
 *   2. revokes every live helper unlock for her family and records who was acting (helper, IP, device),
 *   3. raises a CRITICAL `DURESS_SILENT_ALARM` on the officer Scam Desk,
 *   4. appends `DURESS_PIN_TRIGGERED` to the tenant's hash-chained audit log (system actor, ids and hashes only),
 * and after commit sends a neutral "your account is protected" SMS to her own phone.
 *
 * Zero leakage: nothing citizen- or helper-facing may reveal the alarm. Citizen and helper views map a duress
 * freeze to an ordinary "an officer will decide" state (`citizenFacingStatus`), and the audit event is written
 * under a system actor so it never appears in the helper's own activity list or the citizen's access log.
 */
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { hashSecret, verifySecret } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { cases, citizens, duressAlarms, helperGrants, payments, payoutChanges, payoutDestinations, users } from '@/db/schema/all';
import { writeAudit } from '@/lib/audit';
import { sha256Hex } from '@/lib/hash';
import { log } from '@/lib/log';
import { smsGateway } from './adapters';
import { alertOfficers } from './notify';

export const DURESS_ALARM_TYPE = 'DURESS_SILENT_ALARM';
export const DURESS_AUDIT_ACTION = 'DURESS_PIN_TRIGGERED';
/** prefix of cases.frozen_reason for a duress freeze: officers see it, citizen and helper views never do */
export const DURESS_FREEZE_MARK = 'DURESS_SILENT_ALARM';
const DURESS_FREEZE_REASON = `${DURESS_FREEZE_MARK}: silent duress PIN entered (possible in-person coercion). Do NOT notify the helper.`;

export const reversePin = (pin: string) => pin.split('').reverse().join('');
/** a palindrome PIN (1221, 4554, 0000) has no distinct reverse, so it cannot carry a duress PIN */
export const isPalindromePin = (pin: string) => pin === reversePin(pin);
export const PALINDROME_PIN_MESSAGE = {
  en: 'Choose a PIN that reads differently backwards (not like 1221 or 4554). Your PIN typed backwards is your secret safety PIN.',
  ur: 'ایسا پن چنیں جو الٹا پڑھنے پر مختلف ہو (جیسے 1221 یا 4554 نہیں)۔ آپ کا الٹا پن آپ کا خفیہ حفاظتی پن ہے۔',
};

/** hash of the reversed PIN with the same Argon2id scheme as the PIN itself (null for a palindrome) */
export const duressHashFor = async (pin: string) => (isPalindromePin(pin) ? null : hashSecret(reversePin(pin)));

export type PinMatch = 'real' | 'duress' | 'wrong';

/**
 * Checks a PIN against the real hash, then the duress hash. A legacy account with no duress hash gets one the
 * next time the real PIN is entered (it is derived from the plain PIN, which is only available at that moment).
 */
export async function matchPin(db: DbOrTx, c: { id: string; pinHash: string; duressPinHash: string | null }, pin: string): Promise<PinMatch> {
  if (await verifySecret(c.pinHash, pin)) {
    if (!c.duressPinHash && !isPalindromePin(pin)) {
      await db.update(citizens).set({ duressPinHash: await hashSecret(reversePin(pin)) }).where(eq(citizens.id, c.id));
    }
    return 'real';
  }
  if (c.duressPinHash && (await verifySecret(c.duressPinHash, pin))) return 'duress';
  return 'wrong';
}

export const isDuressFreeze = (frozenReason: string | null | undefined) => !!frozenReason?.startsWith(DURESS_FREEZE_MARK);
/** what the citizen or helper sees: a duress freeze looks like an ordinary officer review */
export const citizenFacingStatus = <S extends string>(status: S, frozenReason: string | null | undefined): S | 'in_review' =>
  status === 'frozen' && isDuressFreeze(frozenReason) ? 'in_review' : status;

export type DuressSession = { requestId: string; actorId: string; actorRole: string | null; ip: string; userAgent: string | null; deviceId?: string | null };
export type DuressTrigger = 'pin_verify' | 'payout_change' | 'helper_unlock';

/** the neutral safety-check SMS: nothing in it alarms someone glancing at the phone */
export const DURESS_SAFETY_SMS = [
  'سایہ ریلیف: آپ کا امدادی اکاؤنٹ محفوظ ہے۔ کوئی رقم منتقل نہیں ہوئی۔ جب آپ اکیلی ہوں تو ہیلپ لائن پر کال کریں یا اپنا والیٹ تصدیق کرنے کے لیے 1 دبائیں۔',
  'Saaya Relief: Your relief account is protected. No money has been moved. When you are alone, call the helpline or press 1 to verify your wallet.',
].join('\n');

/**
 * The lockdown. Runs inside the caller's request transaction so the freeze, the hold, the revocation, the alarm
 * and the audit event commit together or not at all. Returns the alarm id (null when the citizen has no tenant yet).
 */
export async function triggerDuress(db: DbOrTx, o: {
  citizenId: string; trigger: DuressTrigger; session: DuressSession; payoutChangeId?: string | null; helperUserId?: string | null;
  quarantinedGrantId?: string | null; afterCommit?: (fn: () => Promise<void>) => void;
}) {
  // 1a. shadow-freeze every open case (the payout can never be disbursed while frozen)
  const frozen = await db.update(cases).set({ status: 'frozen', frozenReason: DURESS_FREEZE_REASON, priority: 400, updatedAt: new Date() })
    .where(and(eq(cases.citizenId, o.citizenId), notInArray(cases.status, ['closed', 'rejected', 'paid', 'confirmed'])))
    .returning({ id: cases.id, tenantId: cases.tenantId });
  if (frozen.length) {
    await db.update(payments).set({ status: 'hold' }).where(and(inArray(payments.caseId, frozen.map((r) => r.id)), inArray(payments.status, ['scheduled'])));
  }

  // 1b. hold the payout change being submitted, and any other change still waiting
  const held = await db.update(payoutChanges).set({ status: 'duress_hold' })
    .where(and(eq(payoutChanges.citizenId, o.citizenId), inArray(payoutChanges.status, ['pending_officer', 'cooling_off'])))
    .returning({ id: payoutChanges.id, tenantId: payoutChanges.tenantId, fromId: payoutChanges.fromDestinationId, toId: payoutChanges.toDestinationId });
  const change = held.find((h) => h.id === o.payoutChangeId) ?? held[0] ?? null;
  let attempted: { payoutChangeIds: string[]; oldLast4: string | null; newLast4: string | null } | null = null;
  if (change) {
    const dests = await db.select({ id: payoutDestinations.id, last4: payoutDestinations.walletLast4 }).from(payoutDestinations)
      .where(inArray(payoutDestinations.id, [change.toId, ...(change.fromId ? [change.fromId] : [])]));
    attempted = { payoutChangeIds: held.map((h) => h.id), oldLast4: dests.find((d) => d.id === change.fromId)?.last4 ?? null, newLast4: dests.find((d) => d.id === change.toId)?.last4 ?? null };
  }

  // 2. quarantine every live helper unlock for this family
  const revoked = await db.update(helperGrants).set({ revokedAt: new Date() })
    .where(and(eq(helperGrants.citizenId, o.citizenId), isNull(helperGrants.revokedAt)))
    .returning({ id: helperGrants.id, helperUserId: helperGrants.helperUserId });
  const grantIds = [...new Set([...(o.quarantinedGrantId ? [o.quarantinedGrantId] : []), ...revoked.map((g) => g.id)])];
  const helperUserId = o.helperUserId ?? revoked[0]?.helperUserId ?? null;

  // the tenant that owns the alarm: the payout change's, else the most recent case's
  let tenantId = change?.tenantId ?? frozen[0]?.tenantId ?? null;
  let caseId = frozen[0]?.id ?? null;
  if (!tenantId || !caseId) {
    const [k] = await db.select({ id: cases.id, tenantId: cases.tenantId }).from(cases).where(eq(cases.citizenId, o.citizenId)).orderBy(desc(cases.updatedAt)).limit(1);
    tenantId = tenantId ?? k?.tenantId ?? null;
    caseId = caseId ?? k?.id ?? null;
  }

  // 3. the Scam Desk alarm (staff-only evidence, incl. IP and user agent)
  const session = { ...o.session, helperUserId };
  const [alarm] = tenantId ? await db.insert(duressAlarms).values({
    tenantId, citizenId: o.citizenId, caseId, payoutChangeId: change?.id ?? null, trigger: o.trigger, helperUserId,
    helperGrantIds: grantIds, session, attempted, frozenCaseIds: frozen.map((f) => f.id),
  }).returning({ id: duressAlarms.id }) : [];

  // 4. tamper-evident audit event: system actor, ids and hashes only (no raw IP or user agent)
  await writeAudit(db, {
    requestId: o.session.requestId, actorType: 'system', actorId: 'duress.silent_alarm', tenantId, subjectCitizenId: o.citizenId,
    action: DURESS_AUDIT_ACTION, resourceType: 'duress_alarm', resourceId: alarm?.id ?? null, outcome: 'allowed',
    details: {
      alarmType: DURESS_ALARM_TYPE, severity: 'CRITICAL', trigger: o.trigger, caseId, frozenCaseIds: frozen.map((f) => f.id),
      blockedPayoutChangeIds: held.map((h) => h.id), helperUserId, quarantinedGrantIds: grantIds,
      actingUserId: o.session.actorId, ipHash: sha256Hex(o.session.ip).slice(0, 16), userAgentHash: o.session.userAgent ? sha256Hex(o.session.userAgent).slice(0, 16) : null,
    },
  });
  for (const f of frozen) {
    await writeAudit(db, { requestId: o.session.requestId, actorType: 'system', actorId: 'duress.silent_alarm', tenantId: f.tenantId, subjectCitizenId: o.citizenId, action: 'case.freeze', resourceType: 'case', resourceId: f.id, outcome: 'allowed', details: { reason: DURESS_ALARM_TYPE, automatic: true, alarmId: alarm?.id ?? null } });
  }
  if (tenantId) {
    await alertOfficers(db, tenantId, 'CRITICAL — Silent Duress PIN triggered: potential in-person coercion. Do NOT notify the helper. See the Scam Desk.', { duressAlarmId: alarm?.id ?? '', ...(change ? { payoutChangeId: change.id } : {}) });
  }

  // 5. the discreet safety check on her own phone, after commit (a failed SMS never undoes the lockdown)
  const [p] = await db.select({ phone: users.phone }).from(citizens).leftJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, o.citizenId)).limit(1);
  const send = async () => {
    if (!p?.phone) return;
    await smsGateway.send(p.phone, DURESS_SAFETY_SMS, 'notification', 'SAAYA').catch((e) => log('warn', 'duress safety sms failed', { error: String(e) }));
  };
  if (o.afterCommit) o.afterCommit(send); else await send();

  log('warn', 'duress alarm raised', { requestId: o.session.requestId, alarmId: alarm?.id ?? null, trigger: o.trigger });
  return { alarmId: alarm?.id ?? null, frozenCaseIds: frozen.map((f) => f.id), heldPayoutChangeIds: held.map((h) => h.id), revokedGrantIds: grantIds };
}

/** request metadata for the alarm, from the route context */
export const duressSession = (c: { requestId: string; ip: string; req: Request; actor: { id: string; role: string | null } | null }, deviceId?: string | null): DuressSession => ({
  requestId: c.requestId, actorId: c.actor?.id ?? 'anonymous', actorRole: c.actor?.role ?? null, ip: c.ip, userAgent: c.req.headers.get('user-agent'), deviceId: deviceId ?? null,
});
