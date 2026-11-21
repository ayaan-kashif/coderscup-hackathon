import 'server-only';
/**
 * F11 / PAY-2..3: a payout-destination change needs the citizen's PIN, an officer's approval, a cooling-off period
 * (2 minutes in the demo, 72 hours in product) and a notice to the old number with a press-9 objection.
 * An objection freezes the change and opens a complaint. No change ever completes without an officer.
 */
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { decryptPii, encryptPii, piiLookupHash } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { citizens, complaints, payoutChanges, payoutDestinations, users } from '@/db/schema/all';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { hmacHex } from '@/lib/hash';
import { smsGateway } from './adapters';
import { freezeCitizensCases } from './intake';
import { alertOfficers, notifyCitizen, render } from './notify';
import { coolingOffMinutes } from './pipeline/steps';
import { walletSharers } from './pipeline/steps';

const secret = () => {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error('AUTH_JWT_SECRET is not set');
  return s;
};
/** the objection reference printed in the IVR call on the mock phone: PC-<id>:<8-hex HMAC> */
export const objectionToken = (changeId: string) => hmacHex(secret(), `payout-objection:${changeId}`).slice(0, 16);
export const objectionRef = (changeId: string) => `PC-${changeId}:${objectionToken(changeId)}`;

export async function requestPayoutChange(db: DbOrTx, citizenId: string, tenantId: string, walletNo: string, requestedBy: string) {
  const [old] = await db.select().from(payoutDestinations).where(and(eq(payoutDestinations.citizenId, citizenId), eq(payoutDestinations.status, 'active'))).orderBy(desc(payoutDestinations.createdAt)).limit(1);
  const hash = piiLookupHash(walletNo);
  if (old && old.walletHash === hash) throw new ApiError('VALIDATION_FAILED', 'That is already your payout number.');
  const [pending] = await db.select({ id: payoutChanges.id }).from(payoutChanges).where(and(eq(payoutChanges.citizenId, citizenId), inArray(payoutChanges.status, ['pending_officer', 'cooling_off']))).limit(1);
  if (pending) throw new ApiError('CASE_STATE', 'A payout change is already waiting for an officer.');
  // the new destination exists only as "replaced" until the change completes, so no payment can use it early
  const [to] = await db.insert(payoutDestinations).values({ citizenId, tenantId, provider: 'MockPay', walletEnc: encryptPii(walletNo), walletHash: hash, walletLast4: walletNo.slice(-4), status: 'replaced' }).returning({ id: payoutDestinations.id });
  const [ch] = await db.insert(payoutChanges).values({ citizenId, tenantId, fromDestinationId: old?.id ?? null, toDestinationId: to!.id, status: 'pending_officer', requestedBy }).returning();
  // HELP-5: one wallet on 2+ families freezes the cases
  const sharers = await walletSharers(db, hash, citizenId);
  let frozen: string[] = [];
  if (sharers.length) frozen = await freezeCitizensCases(db, tenantId, [citizenId, ...sharers], `payout change to a wallet used by ${sharers.length + 1} families`, { type: 'system', id: 'anomaly:shared_wallet' });
  await alertOfficers(db, tenantId, 'A payout-number change needs approval', { payoutChangeId: ch!.id });
  return { change: ch!, last4: walletNo.slice(-4), frozen };
}

async function citizenPhone(db: DbOrTx, citizenId: string) {
  const [r] = await db.select({ phone: users.phone }).from(citizens).leftJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, citizenId)).limit(1);
  return r?.phone ?? null;
}

export async function approvePayoutChange(db: DbOrTx, id: string, officerId: string) {
  const [ch] = await db.select().from(payoutChanges).where(eq(payoutChanges.id, id)).for('update').limit(1);
  if (!ch) throw new ApiError('NOT_FOUND');
  if (ch.status !== 'pending_officer') throw new ApiError('CASE_STATE', `This change is ${ch.status}.`);
  const minutes = await coolingOffMinutes(db, ch.tenantId, 'cooling_off.payout_change_minutes');
  const until = new Date(Date.now() + minutes * 60_000);
  await db.update(payoutChanges).set({ status: 'cooling_off', approvedBy: officerId, coolingOffUntil: until }).where(eq(payoutChanges.id, id));
  const [to] = await db.select({ last4: payoutDestinations.walletLast4 }).from(payoutDestinations).where(eq(payoutDestinations.id, ch.toDestinationId)).limit(1);
  return { ch, until, last4: to?.last4 ?? '????', phone: await citizenPhone(db, ch.citizenId) };
}

/** after commit: the notice to the old number (SMS + simulated voice call) with the press-9 reference */
export async function sendPayoutNotice(phone: string | null, changeId: string, last4: string) {
  if (!phone) return;
  const en = render('payout_change_notice', { last4 }, 'en');
  const ur = render('payout_change_notice', { last4 }, 'ur');
  await smsGateway.send(phone, `${ur}\n${en}`, 'notification', 'SAAYA').catch(() => {});
  await smsGateway.ivrCall(phone, `${ur} / ${en} (ref ${objectionRef(changeId)})`, '9').catch(() => {});
}

export async function blockPayoutChange(db: DbOrTx, id: string, officerId: string, reason: string) {
  const [ch] = await db.select().from(payoutChanges).where(eq(payoutChanges.id, id)).for('update').limit(1);
  if (!ch) throw new ApiError('NOT_FOUND');
  if (!['pending_officer', 'cooling_off'].includes(ch.status)) throw new ApiError('CASE_STATE', `This change is ${ch.status}.`);
  await db.update(payoutChanges).set({ status: 'rejected', approvedBy: officerId }).where(eq(payoutChanges.id, id));
  return { ch, reason };
}

/** PAY-3: a "9" during cooling-off freezes the change and opens a complaint */
export async function objectToPayoutChange(db: DbOrTx, id: string, token: string) {
  const [ch] = await db.select().from(payoutChanges).where(eq(payoutChanges.id, id)).for('update').limit(1);
  if (!ch || token !== objectionToken(id)) throw new ApiError('NOT_FOUND');
  if (!['pending_officer', 'cooling_off'].includes(ch.status)) throw new ApiError('CASE_STATE', `This change is already ${ch.status}.`);
  await db.update(payoutChanges).set({ status: 'objected', objectedAt: new Date() }).where(eq(payoutChanges.id, id));
  const [cmp] = await db.insert(complaints).values({ tenantId: ch.tenantId, citizenId: ch.citizenId, type: 'payout_objection', channel: 'ivr_press_9', payoutChangeId: id, severity: 3, description: 'Old number pressed 9: "this isn\'t me"' }).returning({ id: complaints.id });
  await alertOfficers(db, ch.tenantId, 'Payout change objected by the old number (press 9); change frozen and complaint opened', { payoutChangeId: id, complaintId: cmp!.id });
  return { ch, complaintId: cmp!.id };
}

/** cooling-off over with no objection → the change completes (idempotent; Inngest cron or lazy read) */
export async function completeDuePayoutChanges(db: DbOrTx) {
  const due = await db.select().from(payoutChanges).where(and(eq(payoutChanges.status, 'cooling_off'), lte(payoutChanges.coolingOffUntil, new Date()))).limit(20);
  let done = 0;
  for (const ch of due) {
    await db.transaction(async (tx) => {
      const [cur] = await tx.select({ status: payoutChanges.status }).from(payoutChanges).where(eq(payoutChanges.id, ch.id)).for('update').limit(1);
      if (cur?.status !== 'cooling_off') return;
      if (ch.fromDestinationId) await tx.update(payoutDestinations).set({ status: 'replaced' }).where(eq(payoutDestinations.id, ch.fromDestinationId));
      await tx.update(payoutDestinations).set({ status: 'active' }).where(eq(payoutDestinations.id, ch.toDestinationId));
      await tx.update(payoutChanges).set({ status: 'approved' }).where(eq(payoutChanges.id, ch.id));
      await writeAudit(tx, { actorType: 'system', actorId: 'payout.cooling_off', tenantId: ch.tenantId, subjectCitizenId: ch.citizenId, action: 'payout.change_completed', resourceType: 'payout_change', resourceId: ch.id, outcome: 'allowed', details: { approvedBy: ch.approvedBy } });
    });
    const [to] = await db.select({ last4: payoutDestinations.walletLast4 }).from(payoutDestinations).where(eq(payoutDestinations.id, ch.toDestinationId)).limit(1);
    await notifyCitizen(db, { tenantId: ch.tenantId, citizenId: ch.citizenId, key: 'payout_change_done', vars: { last4: to?.last4 ?? '' } }).catch(() => {});
    done++;
  }
  return done;
}

export async function listPayoutChanges(db: DbOrTx, tenantId: string) {
  await completeDuePayoutChanges(db).catch(() => 0);
  const rows = await db.select({ ch: payoutChanges, name: citizens.nameDisplay }).from(payoutChanges).leftJoin(citizens, eq(citizens.id, payoutChanges.citizenId)).where(eq(payoutChanges.tenantId, tenantId)).orderBy(desc(payoutChanges.createdAt)).limit(100);
  const out = [];
  for (const r of rows) {
    const dests = await db.select({ id: payoutDestinations.id, last4: payoutDestinations.walletLast4 }).from(payoutDestinations).where(inArray(payoutDestinations.id, [r.ch.toDestinationId, ...(r.ch.fromDestinationId ? [r.ch.fromDestinationId] : [])]));
    const last4 = (id: string | null) => dests.find((d) => d.id === id)?.last4 ?? null;
    out.push({ id: r.ch.id, citizenId: r.ch.citizenId, citizenName: r.name, status: r.ch.status, oldLast4: last4(r.ch.fromDestinationId), newLast4: last4(r.ch.toDestinationId), requestedBy: r.ch.requestedBy, approvedBy: r.ch.approvedBy, coolingOffUntil: r.ch.coolingOffUntil, objectedAt: r.ch.objectedAt, createdAt: r.ch.createdAt });
  }
  return out;
}

export const walletLast4Of = (enc: Buffer) => decryptPii(enc).slice(-4);
