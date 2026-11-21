import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, seededDb, TEST_PASSWORD } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { users } from '@/db/schema/all';
import { base32Decode, base32Encode, hotp, stepAt, totpAt, verifyTotp } from '@/auth/totp';
import * as loginRoute from '../../app/api/v1/auth/login/route';
import * as mfaVerifyRoute from '../../app/api/v1/auth/mfa/verify/route';
import * as mfaSetupRoute from '../../app/api/v1/me/mfa/setup/route';
import * as mfaConfirmRoute from '../../app/api/v1/me/mfa/confirm/route';
import * as switchRoute from '../../app/api/v1/auth/switch-tenant/route';
import * as myTenantsRoute from '../../app/api/v1/me/tenants/route';

let t: TestDb;
const login = (email: string, tenantCode?: string) => call(loginRoute.POST, '/api/v1/auth/login', { body: { email, password: TEST_PASSWORD, ...(tenantCode ? { tenantCode } : {}) }, ip: `10.9.${Math.floor(Math.random() * 200)}.1` });

beforeAll(async () => { t = await seededDb(); });
afterAll(async () => { await t?.close(); });

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 4226 test vectors and round-trips base32', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(['755224', '287082', '359152', '969429', '338314'].map((_, i) => hotp(secret, i))).toEqual(['755224', '287082', '359152', '969429', '338314']);
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('accepts ±1 step and rejects replays', () => {
    const s = base32Encode(Buffer.from('abcdefghijabcdefghij'));
    const now = Date.now();
    const step = verifyTotp(s, totpAt(s, now - 30_000), null, now);
    expect(step).toBe(stepAt(now) - 1);
    expect(verifyTotp(s, totpAt(s, now - 30_000), step, now)).toBeNull();
    expect(verifyTotp(s, '12345', null, now)).toBeNull();
  });
});

describe('AUTH-1 MFA for admins and auditors', () => {
  it('enrol → password alone no longer gives a session → code does → the code cannot be reused', async () => {
    const first = await login('auditor.raza@sindh.amanat.test');
    expect(first.status).toBe(200);
    expect(first.body.mfa).toBe('not_enrolled');
    const tok = first.body.token as string;

    // officers cannot enrol (not an MFA role)
    const off = await login('officer.imran@sindh.amanat.test');
    expect((await call(mfaSetupRoute.POST, '/api/v1/me/mfa/setup', { token: off.body.token, body: {} })).status).toBe(403);

    const setup = await call(mfaSetupRoute.POST, '/api/v1/me/mfa/setup', { token: tok, body: {} });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.body.secret as string;
    // the secret is stored encrypted, never in clear
    const [row] = await t.db.select({ enc: users.mfaSecretEnc }).from(users).where(eq(users.email, 'auditor.raza@sindh.amanat.test'));
    expect(row!.enc!.toString('utf8')).not.toContain(secret);

    expect((await call(mfaConfirmRoute.POST, '/api/v1/me/mfa/confirm', { token: tok, body: { code: '000000' === totpAt(secret) ? '111111' : '000000' } })).status).toBe(422);
    const ok = await call(mfaConfirmRoute.POST, '/api/v1/me/mfa/confirm', { token: tok, body: { code: totpAt(secret, Date.now() - 30_000) } });
    expect(ok.status).toBe(200);

    // the old password-only token is no longer accepted
    expect((await call(mfaSetupRoute.GET, '/api/v1/me/mfa/setup', { token: tok })).status).toBe(401);

    const pw = await login('auditor.raza@sindh.amanat.test');
    expect(pw.status).toBe(200);
    expect(pw.body.mfaRequired).toBe(true);
    expect(pw.body.token).toBeUndefined();
    // the challenge is not a session token
    expect((await call(mfaSetupRoute.GET, '/api/v1/me/mfa/setup', { token: pw.body.challenge })).status).toBe(401);

    expect((await call(mfaVerifyRoute.POST, '/api/v1/auth/mfa/verify', { body: { challenge: pw.body.challenge, code: '12345a' } })).status).toBe(422);
    const code = totpAt(secret);
    const v = await call(mfaVerifyRoute.POST, '/api/v1/auth/mfa/verify', { body: { challenge: pw.body.challenge, code } });
    expect(v.status).toBe(200);
    expect(v.body.mfa).toBe('passed');
    const st = await call(mfaSetupRoute.GET, '/api/v1/me/mfa/setup', { token: v.body.token });
    expect(st.body).toMatchObject({ enabled: true, thisSession: true });

    const again = await login('auditor.raza@sindh.amanat.test');
    expect((await call(mfaVerifyRoute.POST, '/api/v1/auth/mfa/verify', { body: { challenge: again.body.challenge, code } })).status).toBe(401);
  });
});

describe('TEN-4 tenant switcher', () => {
  it('lists only tenants with a membership, switches between them, and 404s anything else', async () => {
    const sana = await login('admin.sana@sindh.amanat.test');
    expect(sana.status).toBe(200);
    expect(sana.body.user.tenant.code).toBe('sindh');
    const list = await call(myTenantsRoute.GET, '/api/v1/me/tenants', { token: sana.body.token });
    expect(list.body.items.map((x: { code: string }) => x.code).sort()).toEqual(['sandbox', 'sindh']);

    const sw = await call(switchRoute.POST, '/api/v1/auth/switch-tenant', { token: sana.body.token, body: { tenantCode: 'sandbox' } });
    expect(sw.status).toBe(200);
    expect(sw.body.user.tenant.code).toBe('sandbox');
    expect(sw.body.user.role).toBe('admin');

    const notMine = await call(switchRoute.POST, '/api/v1/auth/switch-tenant', { token: sana.body.token, body: { tenantCode: 'punjab' } });
    expect(notMine.status).toBe(404);
    const unknown = await call(switchRoute.POST, '/api/v1/auth/switch-tenant', { token: sana.body.token, body: { tenantCode: 'nowhere' } });
    expect(unknown.status).toBe(404);

    const imran = await login('officer.imran@sindh.amanat.test');
    const one = await call(myTenantsRoute.GET, '/api/v1/me/tenants', { token: imran.body.token });
    expect(one.body.items).toHaveLength(1);
  });
});
