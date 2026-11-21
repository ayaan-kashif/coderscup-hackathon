import { randomInt } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { citizens, memberships, tenants, users } from '@/db/schema/all';
import type { Role } from '@/auth/actor';
import { decryptPii, encryptPii, hashSecret, otpHash, safeEqualHex, verifySecret } from '@/auth/crypto';
import { signAccessToken, signMfaChallenge, verifyMfaChallenge } from '@/auth/tokens';
import { newTotpSecret, otpauthUri, verifyTotp } from '@/auth/totp';
import { duressHashFor, isPalindromePin, matchPin, PALINDROME_PIN_MESSAGE } from './duress';
import { ApiError } from '@/lib/errors';

export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;
/** AUTH-3 */
export const PIN_MAX_TRIES = 5;
export const PIN_LOCK_MINUTES = 15;

// a constant hash so unknown emails take as long as wrong passwords
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashSecret('not-a-real-password-for-timing'));

/** AUTH-1: roles that must pass TOTP once enrolled */
export const MFA_ROLES = new Set<Role>(['admin', 'auditor']);

async function staffMemberships(db: DbOrTx, userId: string) {
  return db.select({ tenantId: memberships.tenantId, role: memberships.role, isSenior: memberships.isSenior, code: tenants.code, name: tenants.name })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId)).where(eq(memberships.userId, userId))
    .orderBy(asc(tenants.isSandbox), asc(memberships.createdAt), asc(tenants.code));
}

type StaffUser = { id: string; displayName: string; mfaEnabledAt: Date | null };
type Membership = Awaited<ReturnType<typeof staffMemberships>>[number];

async function issueStaffSession(db: DbOrTx, u: StaffUser, m: Membership, ms: Membership[], mfa: boolean) {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const token = await signAccessToken({ sub: u.id, kind: 'staff', app_role: m.role, tid: m.tenantId, senior: m.isSenior, ...(mfa ? { mfa: true } : {}) });
  const mfaState = !MFA_ROLES.has(m.role as Role) ? 'not_needed' : u.mfaEnabledAt ? 'passed' : 'not_enrolled';
  return {
    mfaRequired: false as const, token, mfa: mfaState,
    user: { id: u.id, displayName: u.displayName, role: m.role as Role, tenant: { id: m.tenantId, code: m.code, name: m.name } },
    tenants: ms.map((x) => ({ code: x.code, name: x.name, role: x.role })),
  };
}

export async function staffLogin(db: DbOrTx, email: string, password: string, tenantCode?: string) {
  const [u] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), eq(users.kind, 'staff'))).limit(1);
  const ok = u?.passwordHash ? await verifySecret(u.passwordHash, password) : (await verifySecret(await getDummyHash(), password), false);
  if (!u || !ok) throw new ApiError('UNAUTHENTICATED', 'Wrong email or password.');

  const ms = await staffMemberships(db, u.id);
  // TEN-4: only tenants where the user holds a membership
  const m = tenantCode ? ms.find((x) => x.code === tenantCode) : ms[0];
  if (!m) throw new ApiError('UNAUTHENTICATED', tenantCode ? 'You have no role in that tenant.' : 'This account has no role in any tenant.');
  // AUTH-1: an enrolled admin or auditor gets a 5-minute challenge, not a session, until the TOTP code is checked
  if (MFA_ROLES.has(m.role as Role) && u.mfaEnabledAt) {
    return { mfaRequired: true as const, challenge: await signMfaChallenge({ sub: u.id, tid: m.tenantId }), user: { id: u.id, role: m.role as Role, tenant: { id: m.tenantId } } };
  }
  return issueStaffSession(db, u, m, ms, false);
}

/** AUTH-1: second step (the route rate-limits tries per account and per IP) */
export async function completeMfaLogin(db: DbOrTx, challenge: string, code: string) {
  const ch = await verifyMfaChallenge(challenge);
  if (!ch) throw new ApiError('UNAUTHENTICATED', 'The sign-in step expired. Enter your password again.');
  const [u] = await db.select().from(users).where(and(eq(users.id, ch.sub), eq(users.kind, 'staff'))).limit(1);
  if (!u?.mfaSecretEnc || !u.mfaEnabledAt) throw new ApiError('UNAUTHENTICATED', 'MFA is not set up for this account.');
  const step = verifyTotp(decryptPii(u.mfaSecretEnc), code, u.mfaLastStep ?? null);
  if (step === null) throw new ApiError('UNAUTHENTICATED', 'Wrong or reused code.');
  // remember the step so the same code cannot be used twice
  const used = await db.update(users).set({ mfaLastStep: step }).where(and(eq(users.id, u.id), sql`coalesce(${users.mfaLastStep}, -1) < ${step}`)).returning({ id: users.id });
  if (!used.length) throw new ApiError('UNAUTHENTICATED', 'Wrong or reused code.');
  const ms = await staffMemberships(db, u.id);
  const m = ms.find((x) => x.tenantId === ch.tid);
  if (!m) throw new ApiError('UNAUTHENTICATED', 'You have no role in that tenant.');
  return issueStaffSession(db, u, m, ms, true);
}

/** AUTH-1 enrolment: a new secret, stored encrypted but not active until a code is confirmed */
export async function startMfaSetup(db: DbOrTx, userId: string) {
  const [u] = await db.select({ email: users.email, enabled: users.mfaEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.email) throw new ApiError('NOT_FOUND', 'Staff account not found.');
  if (u.enabled) throw new ApiError('CASE_STATE', 'MFA is already on for this account.');
  const secretB32 = newTotpSecret();
  await db.update(users).set({ mfaSecretEnc: encryptPii(secretB32), mfaLastStep: null }).where(eq(users.id, userId));
  return { secret: secretB32, otpauthUri: otpauthUri(secretB32, u.email) };
}

export async function confirmMfaSetup(db: DbOrTx, userId: string, code: string) {
  const [u] = await db.select({ enc: users.mfaSecretEnc, enabled: users.mfaEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.enc) throw new ApiError('CASE_STATE', 'Start MFA setup first.');
  if (u.enabled) throw new ApiError('CASE_STATE', 'MFA is already on for this account.');
  const step = verifyTotp(decryptPii(u.enc), code, null);
  if (step === null) throw new ApiError('VALIDATION_FAILED', 'That code does not match. Check the time on your phone and try again.');
  await db.update(users).set({ mfaEnabledAt: new Date(), mfaLastStep: step }).where(eq(users.id, userId));
  return { enabled: true };
}

export async function mfaStatus(db: DbOrTx, userId: string) {
  const [u] = await db.select({ enabled: users.mfaEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  return { enabled: !!u?.enabled, enabledAt: u?.enabled ?? null };
}

/** TEN-4: switch the console to another tenant where the user holds a membership (new 15-minute token) */
export async function switchTenant(db: DbOrTx, userId: string, tenantCode: string, sessionHadMfa: boolean) {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.kind, 'staff'))).limit(1);
  if (!u) throw new ApiError('UNAUTHENTICATED', 'Sign in again.');
  const ms = await staffMemberships(db, u.id);
  const m = ms.find((x) => x.code === tenantCode);
  // not a member: 404, the same answer as for a tenant that does not exist (TEN-2)
  if (!m) throw new ApiError('NOT_FOUND', 'Tenant not found.');
  if (MFA_ROLES.has(m.role as Role) && u.mfaEnabledAt && !sessionHadMfa) throw new ApiError('UNAUTHENTICATED', 'Sign in with your MFA code to open this role.', { extra: { next: 'mfa' } });
  return issueStaffSession(db, u, m, ms, sessionHadMfa);
}

export async function listMyTenants(db: DbOrTx, userId: string) {
  return (await staffMemberships(db, userId)).map((x) => ({ code: x.code, name: x.name, role: x.role }));
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

/** `duress: true` is for the server only: callers must answer exactly as for the real PIN and run triggerDuress */
export type PinCheck = { ok: true; token: string; duress: boolean } | { ok: false; locked: boolean; left: number; lockedUntil?: Date };

/** AUTH-3: 5 wrong tries lock the PIN for 15 minutes. Must run in a transaction that commits on failure too. */
export async function checkPin(db: DbOrTx, userId: string, pin: string): Promise<PinCheck> {
  const [c] = await db.select().from(citizens).where(eq(citizens.userId, userId)).for('update').limit(1);
  if (!c?.pinHash) throw new ApiError('VALIDATION_FAILED', 'No PIN is set for this account yet.', { extra: { next: 'pin_set' } });
  const now = Date.now();
  if (c.pinLockedUntil && c.pinLockedUntil.getTime() > now) return { ok: false, locked: true, left: 0, lockedUntil: c.pinLockedUntil };
  const match = await matchPin(db, { id: c.id, pinHash: c.pinHash, duressPinHash: c.duressPinHash }, pin);
  if (match === 'wrong') {
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
  return { ok: true, token, duress: match === 'duress' };
}

export async function setPin(db: DbOrTx, userId: string, pin: string) {
  const [c] = await db.select({ id: citizens.id, pinHash: citizens.pinHash }).from(citizens).where(eq(citizens.userId, userId)).limit(1);
  if (!c) throw new ApiError('VALIDATION_FAILED', 'Your citizen profile is created when you apply; set the PIN in the apply flow.', { extra: { next: 'apply' } });
  if (c.pinHash) throw new ApiError('VALIDATION_FAILED', 'A PIN is already set. Use it to continue; an officer can reset a forgotten PIN.');
  // Silent Duress PIN: the reversed PIN is the safety PIN, so it must differ from the PIN (no palindromes such as
  // 1221, 4554 or 0000). Checked first so the citizen hears why, in both languages.
  if (isPalindromePin(pin)) throw new ApiError('VALIDATION_FAILED', `${PALINDROME_PIN_MESSAGE.en} / ${PALINDROME_PIN_MESSAGE.ur}`, { extra: { reason: 'palindrome', en: PALINDROME_PIN_MESSAGE.en, ur: PALINDROME_PIN_MESSAGE.ur } });
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '3210'].includes(pin)) throw new ApiError('VALIDATION_FAILED', 'Choose a PIN that is harder to guess.');
  await db.update(citizens).set({ pinHash: await hashSecret(pin), duressPinHash: await duressHashFor(pin) }).where(eq(citizens.id, c.id));
  return signAccessToken({ sub: userId, kind: 'citizen', app_role: 'citizen', cid: c.id, stage: 'full' });
}
