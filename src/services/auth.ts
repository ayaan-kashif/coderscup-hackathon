import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { citizens, memberships, tenants, users } from '@/db/schema/all';
import type { Role } from '@/auth/actor';
import { hashSecret, otpHash, safeEqualHex, verifySecret } from '@/auth/crypto';
import { signAccessToken } from '@/auth/tokens';
import { ApiError } from '@/lib/errors';

export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;
/** AUTH-3 */
export const PIN_MAX_TRIES = 5;
export const PIN_LOCK_MINUTES = 15;

// a constant hash so unknown emails take as long as wrong passwords
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashSecret('not-a-real-password-for-timing'));

export async function staffLogin(db: DbOrTx, email: string, password: string, tenantCode?: string) {
  const [u] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), eq(users.kind, 'staff'))).limit(1);
  const ok = u?.passwordHash ? await verifySecret(u.passwordHash, password) : (await verifySecret(await getDummyHash(), password), false);
  if (!u || !ok) throw new ApiError('UNAUTHENTICATED', 'Wrong email or password.');

  const ms = await db.select({ tenantId: memberships.tenantId, role: memberships.role, isSenior: memberships.isSenior, code: tenants.code, name: tenants.name })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId)).where(eq(memberships.userId, u.id));
  // TEN-4: only tenants where the user holds a membership
  const m = tenantCode ? ms.find((x) => x.code === tenantCode) : ms[0];
  if (!m) throw new ApiError('UNAUTHENTICATED', tenantCode ? 'You have no role in that tenant.' : 'This account has no role in any tenant.');
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const token = await signAccessToken({ sub: u.id, kind: 'staff', app_role: m.role, tid: m.tenantId, senior: m.isSenior });
  return { token, user: { id: u.id, displayName: u.displayName, role: m.role as Role, tenant: { id: m.tenantId, code: m.code, name: m.name } }, tenants: ms.map((x) => ({ code: x.code, name: x.name, role: x.role })) };
}

/** Creates (or refreshes) a one-time code. The caller sends it to the MOCK SMS inbox after commit. */
export async function issueOtp(db: DbOrTx, phone: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const values = { otpHash: otpHash(phone, code), otpExpiresAt: sql`now() + make_interval(mins => ${OTP_TTL_MIN})` as unknown as Date, otpAttempts: 0 };
  await db.insert(users).values({ kind: 'citizen', phone, displayName: 'Citizen', ...values })
    .onConflictDoUpdate({ target: users.phone, set: values });
  return code;
}

export type OtpCheck = { ok: true; token: string; pinSet: boolean; hasProfile: boolean } | { ok: false; reason: 'expired' | 'wrong' | 'too_many'; left: number };

export async function checkOtp(db: DbOrTx, phone: string, code: string): Promise<OtpCheck> {
  const [u] = await db.select().from(users).where(and(eq(users.phone, phone), eq(users.kind, 'citizen'))).for('update').limit(1);
  if (!u?.otpHash || !u.otpExpiresAt || u.otpExpiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired', left: 0 };
  if (u.otpAttempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many', left: 0 };
  if (!safeEqualHex(u.otpHash, otpHash(phone, code))) {
    await db.update(users).set({ otpAttempts: u.otpAttempts + 1 }).where(eq(users.id, u.id));
    return { ok: false, reason: 'wrong', left: OTP_MAX_ATTEMPTS - u.otpAttempts - 1 };
  }
  await db.update(users).set({ otpHash: null, otpExpiresAt: null, otpAttempts: 0, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const [c] = await db.select({ id: citizens.id, pinHash: citizens.pinHash }).from(citizens).where(eq(citizens.userId, u.id)).limit(1);
  // stage 'otp': the device is registered, but nothing personal opens before the PIN (AUTH-2)
  const token = await signAccessToken({ sub: u.id, kind: 'citizen', app_role: 'citizen', cid: c?.id, stage: 'otp' });
  return { ok: true, token, pinSet: !!c?.pinHash, hasProfile: !!c };
}

export type PinCheck = { ok: true; token: string } | { ok: false; locked: boolean; left: number; lockedUntil?: Date };

/** AUTH-3: 5 wrong tries lock the PIN for 15 minutes. Must run in a transaction that commits on failure too. */
export async function checkPin(db: DbOrTx, userId: string, pin: string): Promise<PinCheck> {
  const [c] = await db.select().from(citizens).where(eq(citizens.userId, userId)).for('update').limit(1);
  if (!c?.pinHash) throw new ApiError('VALIDATION_FAILED', 'No PIN is set for this account yet.', { extra: { next: 'pin_set' } });
  const now = Date.now();
  if (c.pinLockedUntil && c.pinLockedUntil.getTime() > now) return { ok: false, locked: true, left: 0, lockedUntil: c.pinLockedUntil };
  if (!(await verifySecret(c.pinHash, pin))) {
    const tries = (c.pinLockedUntil && c.pinLockedUntil.getTime() <= now ? 0 : c.pinFailedAttempts) + 1;
    if (tries >= PIN_MAX_TRIES) {
      const until = new Date(now + PIN_LOCK_MINUTES * 60_000);
      await db.update(citizens).set({ pinFailedAttempts: 0, pinLockedUntil: until }).where(eq(citizens.id, c.id));
      return { ok: false, locked: true, left: 0, lockedUntil: until };
    }
    await db.update(citizens).set({ pinFailedAttempts: tries, pinLockedUntil: null }).where(eq(citizens.id, c.id));
    return { ok: false, locked: false, left: PIN_MAX_TRIES - tries };
  }
  await db.update(citizens).set({ pinFailedAttempts: 0, pinLockedUntil: null }).where(eq(citizens.id, c.id));
  const token = await signAccessToken({ sub: userId, kind: 'citizen', app_role: 'citizen', cid: c.id, stage: 'full' });
  return { ok: true, token };
}

export async function setPin(db: DbOrTx, userId: string, pin: string) {
  const [c] = await db.select({ id: citizens.id, pinHash: citizens.pinHash }).from(citizens).where(eq(citizens.userId, userId)).limit(1);
  if (!c) throw new ApiError('VALIDATION_FAILED', 'Your citizen profile is created when you apply; set the PIN in the apply flow.', { extra: { next: 'apply' } });
  if (c.pinHash) throw new ApiError('VALIDATION_FAILED', 'A PIN is already set. Use it to continue; an officer can reset a forgotten PIN.');
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123'].includes(pin)) throw new ApiError('VALIDATION_FAILED', 'Choose a PIN that is harder to guess.');
  await db.update(citizens).set({ pinHash: await hashSecret(pin) }).where(eq(citizens.id, c.id));
  return signAccessToken({ sub: userId, kind: 'citizen', app_role: 'citizen', cid: c.id, stage: 'full' });
}
