/**
 * Real-number sign-in through the Baileys gateway (fetch mocked) and the new-citizen flow: one account per number even with parallel
 * verifies, a PIN, "About you" saved step by step, citizens sealed from each other, and "delete my account and data".
 */
import { and, count, eq, isNotNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as otpChannels from '../../app/api/v1/auth/otp/channels/route';
import * as otpRequest from '../../app/api/v1/auth/otp/request/route';
import * as otpVerify from '../../app/api/v1/auth/otp/verify/route';
import * as pinSet from '../../app/api/v1/auth/pin/set/route';
import * as pinVerify from '../../app/api/v1/auth/pin/verify/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as cases from '../../app/api/v1/cases/route';
import * as consents from '../../app/api/v1/me/consents/route';
import * as meCases from '../../app/api/v1/me/cases/route';
import * as onboarding from '../../app/api/v1/me/onboarding/route';
import * as me from '../../app/api/v1/me/route';
import { decryptPii, piiLookupHash } from '@/auth/crypto';
import { auditEvents, cases as casesT, citizens, consents as consentsT, users } from '@/db/schema/all';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { purgeWhatsappAccounts } from '@/services/account';
import { getSystemStatus } from '@/services/status';
import { resetGatewayHealthCache } from '@/services/otp/sender';
import { aiOff, aiReset } from '../helpers/ai';
import { call, idem, seededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 120_000 });

const SECRET = 'g'.repeat(32);
const A = '+923001234567';
const B = '+923331234567';
let t: TestDb;
let lastCode = '';
const sends: { to: string; lang: string }[] = [];
let gateway: { health: () => { ok: boolean; body?: unknown }; send: () => { status: number; body?: unknown } };
const realFetch = globalThis.fetch;
const keep = { p: process.env.OTP_PROVIDER, u: process.env.WA_GATEWAY_URL, s: process.env.WA_GATEWAY_SECRET };
let ipN = 20;
const ip = () => `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`;

beforeAll(async () => { aiOff(); t = await seededDb(); }, 300_000);
afterAll(async () => { aiReset(); globalThis.fetch = realFetch; await t.close(); });
beforeEach(() => {
  process.env.OTP_PROVIDER = 'baileys';
  process.env.WA_GATEWAY_URL = 'https://gw.test';
  process.env.WA_GATEWAY_SECRET = SECRET;
  resetMemoryRateLimits();
  resetGatewayHealthCache();
  sends.length = 0;
  gateway = { health: () => ({ ok: true, body: { connected: true } }), send: () => ({ status: 200, body: { messageId: 'M1' } }) };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://gw.test/health')) { const h = gateway.health(); return new Response(JSON.stringify(h.body ?? {}), { status: h.ok ? 200 : 503 }); }
    if (u.startsWith('https://gw.test/send-otp')) {
      const b = JSON.parse(String(init?.body));
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
      const r = gateway.send();
      if (r.status === 200) { lastCode = b.code; sends.push({ to: b.to, lang: b.lang }); }
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
    }
    return realFetch(url as never, init);
  }) as typeof fetch;
});
afterEach(() => {
  for (const [k, v] of [['OTP_PROVIDER', keep.p], ['WA_GATEWAY_URL', keep.u], ['WA_GATEWAY_SECRET', keep.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const request = (phone: string, extra: Record<string, unknown> = {}) => call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone, ...extra }, ip: ip() });

async function signUp(phone: string, pin = '4729') {
  expect((await request(phone)).status).toBe(202);
  const ver = await call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone, code: lastCode }, ip: ip() });
  expect(ver.status, JSON.stringify(ver.body)).toBe(200);
  const set = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: ver.body.token, body: { pin } });
  expect(set.status, JSON.stringify(set.body)).toBe(201);
  return { token: set.body.token as string, pin, verify: ver.body };
}

async function onboard(token: string, pin: string, name: string, district = 'BDN') {
  expect((await call(me.PATCH, '/api/v1/me', { token, body: { trustPictureId: 4 } })).status).toBe(200);
  const cons = await call(consents.GET, '/api/v1/me/consents', { token });
  expect(cons.body.consents).toHaveLength(0);
  expect(cons.body.offices[0].code).toBe('sindh');
  const g = await call(consents.POST, '/api/v1/me/consents', { token, body: { tenantId: cons.body.offices[0].id, pin } });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  expect((await call(me.PATCH, '/api/v1/me', { token, body: { fullName: name } })).status).toBe(200);
  expect((await call(me.PATCH, '/api/v1/me', { token, body: { dob: '1975-05-20' } })).status).toBe(200);
  expect((await call(me.PATCH, '/api/v1/me', { token, body: { districtCode: district } })).status).toBe(200);
}

describe('WhatsApp codes through the gateway', () => {
  it('a real number gets its code from the gateway; the code is never in the response; the number is stored encrypted plus its hash only', async () => {
    const r = await request('03001234567', { lang: 'ur' });
    expect(r.status).toBe(202);
    expect(r.body.channel).toBe('whatsapp');
    expect(r.text).not.toContain(lastCode);
    expect(r.body.inbox).toBeUndefined();
    expect(sends).toEqual([{ to: A, lang: 'ur' }]);
    const [u] = await t.db.select().from(users).where(eq(users.phoneHash, piiLookupHash(A)));
    expect(u!.phone).toBeNull(); // the plain-text column is for fictional numbers only
    expect(decryptPii(u!.phoneEnc!)).toBe(A);
    expect(JSON.stringify(u)).not.toContain('3001234567');
    // the audit log holds no number and no code
    const audit = JSON.stringify(await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'auth.otp_request')));
    expect(audit).not.toContain('3001234567');
    expect(audit).not.toContain(lastCode);
  });

  it('fictional +92 00000 numbers keep using the mock phone and never call the gateway', async () => {
    const r = await request('+920000000001');
    expect(r.status).toBe(202);
    expect(r.body.channel).toBe('mock_sms');
    expect(r.body.inbox).toContain('/mock/phone');
    expect(sends).toHaveLength(0);
  });

  it('gateway down: 503 with a clear message and a "whatsapp_unavailable" reason, and nothing is stored', async () => {
    gateway.health = () => ({ ok: false });
    const r = await request(B);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('whatsapp_unavailable');
    expect(r.body.en).toBe('WhatsApp is not available right now.');
    expect(sends).toHaveLength(0);
    const n = (await t.db.select({ n: count() }).from(users).where(eq(users.phoneHash, piiLookupHash(B))))[0]!.n;
    expect(n).toBe(0);
    const ch = await call(otpChannels.GET, '/api/v1/auth/otp/channels', { ip: ip() });
    expect(ch.body).toEqual({ whatsapp: false });
  });

  it('GET /otp/channels says whatsapp:true when the gateway is connected, and false when OTP_PROVIDER is off', async () => {
    expect((await call(otpChannels.GET, '/api/v1/auth/otp/channels', { ip: ip() })).body).toEqual({ whatsapp: true });
    process.env.OTP_PROVIDER = 'mock';
    expect((await call(otpChannels.GET, '/api/v1/auth/otp/channels', { ip: ip() })).body).toEqual({ whatsapp: false });
  });

  it('not on WhatsApp: 422, and the code is rolled back with it', async () => {
    gateway.send = () => ({ status: 404, body: { code: 'NOT_ON_WHATSAPP' } });
    const r = await request(B);
    expect(r.status).toBe(422);
    expect(r.body.reason).toBe('not_on_whatsapp');
    expect(r.body.ur).toMatch(/واٹس ایپ/);
    const n = (await t.db.select({ n: count() }).from(users).where(eq(users.phoneHash, piiLookupHash(B))))[0]!.n;
    expect(n).toBe(0);
  });

  it('the gateway asking us to wait is a 429 with Retry-After; a 401/5xx from it is a 503 "not available"', async () => {
    gateway.send = () => ({ status: 429, body: { retryAfterSec: 33 } });
    const w = await request(B);
    expect(w.status).toBe(429);
    expect(w.headers.get('retry-after')).toBe('33');
    expect(w.body.retryAfterSec).toBe(33);
    gateway.send = () => ({ status: 401 });
    const d = await request(B);
    expect(d.status).toBe(503);
    expect(d.body.reason).toBe('whatsapp_unavailable');
  });

  it('with OTP_PROVIDER off a real number is refused and the gateway is not called', async () => {
    process.env.OTP_PROVIDER = 'mock';
    const r = await request(A);
    expect(r.status).toBe(422);
    expect(r.body.reason).toBe('whatsapp_off');
    expect(sends).toHaveLength(0);
  });

  it('a malformed number is refused in both languages', async () => {
    const r = await request('12345');
    expect(r.status).toBe(422);
    expect(r.body.ur).toMatch(/موبائل/);
  });
});

describe('/status', () => {
  it('shows "WhatsApp gateway: connected / disconnected" without any number, and nothing when WhatsApp is off', async () => {
    const up = await getSystemStatus(t.db);
    expect(up.checks.whatsappGateway?.detail).toBe('WhatsApp gateway: connected');
    expect(up.checks.whatsappGateway?.status).toBe('ok');
    gateway.health = () => ({ ok: false });
    resetGatewayHealthCache();
    const down = await getSystemStatus(t.db);
    expect(String(down.checks.whatsappGateway?.detail)).toMatch(/^WhatsApp gateway: disconnected/);
    expect(JSON.stringify(down.checks.whatsappGateway)).not.toMatch(/\+92|\d{7}/);
    process.env.OTP_PROVIDER = 'mock';
    expect((await getSystemStatus(t.db)).checks.whatsappGateway).toBeUndefined();
  });
});

describe('a new number becomes one citizen', () => {
  it('two parallel verifies of the same code create exactly one citizen and one user', async () => {
    const phone = '+923451110001';
    await request(phone);
    const code = lastCode;
    const [x, y] = await Promise.all([
      call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone, code }, ip: ip() }),
      call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone, code }, ip: ip() }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 401]); // one wins, the code is single-use
    const ok = x.status === 200 ? x : y;
    expect(ok.body.next).toBe('pin_set');
    expect(ok.body.newAccount).toBe(true);
    const us = await t.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, piiLookupHash(phone)));
    expect(us).toHaveLength(1);
    expect(await t.db.select({ id: citizens.id }).from(citizens).where(eq(citizens.userId, us[0]!.id))).toHaveLength(1);
  });

  it('parallel first code requests also make one user (upsert on the hash)', async () => {
    const phone = '+923451110002';
    await Promise.all([request(phone), request(phone)]);
    expect(await t.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, piiLookupHash(phone)))).toHaveLength(1);
  });

  it('a returning number opens the same account and goes to the PIN screen', async () => {
    const s = await signUp('+923451110003');
    const [u1] = await t.db.select().from(users).where(eq(users.phoneHash, piiLookupHash('+923451110003')));
    await request('0345 1110003'); // typed differently, same person
    const ver = await call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone: '+92 345 1110003', code: lastCode }, ip: ip() });
    expect(ver.status).toBe(200);
    expect(ver.body.next).toBe('pin_verify');
    expect(ver.body.newAccount).toBe(false);
    const full = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: ver.body.token, body: { pin: s.pin } });
    expect(full.status).toBe(200);
    const all = await t.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, piiLookupHash('+923451110003')));
    expect(all).toEqual([{ id: u1!.id }]);
  });

  it('the PIN rules still apply: a palindrome is refused in both languages, and the reversed PIN is stored for the duress rule', async () => {
    const phone = '+923451110004';
    await request(phone);
    const ver = await call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone, code: lastCode }, ip: ip() });
    const bad = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: ver.body.token, body: { pin: '1221' } });
    expect(bad.status).toBe(422);
    expect(bad.body.reason).toBe('palindrome');
    expect(bad.body.ur).toBeTruthy();
    const ok = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: ver.body.token, body: { pin: '4729' } });
    expect(ok.status).toBe(201);
    const [u] = await t.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, piiLookupHash(phone)));
    const [c] = await t.db.select({ pin: citizens.pinHash, duress: citizens.duressPinHash }).from(citizens).where(eq(citizens.userId, u!.id));
    expect(c!.pin).toBeTruthy();
    expect(c!.duress).toBeTruthy();
    expect(c!.duress).not.toBe(c!.pin);
  });
});

describe('onboarding: saved step by step, resumes where she stopped', () => {
  it('trust picture → consent → name → date of birth → district, each saved on its own', async () => {
    const s = await signUp('+923451110005');
    const step = async () => (await call(onboarding.GET, '/api/v1/me/onboarding', { token: s.token })).body;
    expect((await step()).step).toBe('trust');
    await call(me.PATCH, '/api/v1/me', { token: s.token, body: { trustPictureId: 7 } });
    expect((await step()).step).toBe('consent');
    const cons = await call(consents.GET, '/api/v1/me/consents', { token: s.token });
    await call(consents.POST, '/api/v1/me/consents', { token: s.token, body: { tenantId: cons.body.offices[0].id, pin: s.pin } });
    expect((await step()).step).toBe('name');
    await call(me.PATCH, '/api/v1/me', { token: s.token, body: { fullName: 'Amina Test' } });
    expect((await step()).step).toBe('dob');
    expect((await call(me.PATCH, '/api/v1/me', { token: s.token, body: { dob: '2015-01-01' } })).status).toBe(422); // not an adult
    expect((await call(me.PATCH, '/api/v1/me', { token: s.token, body: { dob: '1990-02-31' } })).status).toBe(422); // no such date
    await call(me.PATCH, '/api/v1/me', { token: s.token, body: { dob: '1988-03-09' } });
    const d = await step();
    expect(d.step).toBe('district');
    expect(d.districts.map((x: { code: string }) => x.code).sort()).toEqual(['BDN', 'HYD', 'KHS', 'SKR', 'THP', 'TTA']); // only the office she agreed to
    expect((await call(me.PATCH, '/api/v1/me', { token: s.token, body: { districtCode: 'LHR' } })).status).toBe(422); // Punjab: not her office
    await call(me.PATCH, '/api/v1/me', { token: s.token, body: { districtCode: 'HYD' } });
    const done = await step();
    expect(done.step).toBe('done');
    expect(done.profile.name).toBe('Amina Test');
    const who = await call(me.GET, '/api/v1/me', { token: s.token });
    expect(who.body.displayName).toBe('Amina Test');
    // names and dates never enter the audit log
    expect(JSON.stringify(await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'self.update')))).not.toMatch(/Amina|1988/);
  });
});

describe('citizens are sealed from each other, and deleting an account removes her data', () => {
  let a: { token: string; pin: string }; let b: { token: string; pin: string };
  let caseB: string;
  beforeAll(async () => {
    beforeEachSetup();
    a = await signUp('+923451110011');
    await onboard(a.token, a.pin, 'Citizen A');
    b = await signUp('+923451110012');
    await onboard(b.token, b.pin, 'Citizen B');
    const c = await call(cases.POST, '/api/v1/cases', { token: b.token, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'b-first-application-1' } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    caseB = c.body.id;
  });
  function beforeEachSetup() {
    process.env.OTP_PROVIDER = 'baileys'; process.env.WA_GATEWAY_URL = 'https://gw.test'; process.env.WA_GATEWAY_SECRET = SECRET;
  }

  it('A gets 404 for B\'s case and does not see it in her own list', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseB}`, { token: a.token, params: { id: caseB } });
    expect(r.status).toBe(404);
    const mine = await call(meCases.GET, '/api/v1/me/cases', { token: a.token });
    expect(JSON.stringify(mine.body)).not.toContain(caseB);
    const bs = await call(meCases.GET, '/api/v1/me/cases', { token: b.token });
    expect(JSON.stringify(bs.body)).toContain(caseB);
  });

  it('a new person is not in the identity registry, so the case waits for an officer (no auto-approval)', async () => {
    const [row] = await t.db.select({ status: casesT.status, citizen: casesT.citizenId }).from(casesT).where(eq(casesT.id, caseB));
    expect(row!.status).toBe('draft');
    expect(row!.citizen).toBeTruthy();
  });

  it('deleting needs the right PIN and the confirmation; then her user, citizen, consents and cases are gone, and B is untouched', async () => {
    const [ua] = await t.db.select({ id: users.id }).from(users).where(eq(users.phoneHash, piiLookupHash('+923451110011')));
    const [ca] = await t.db.select({ id: citizens.id }).from(citizens).where(eq(citizens.userId, ua!.id));
    // A makes a case too, so there is something to delete
    const mine = await call(cases.POST, '/api/v1/cases', { token: a.token, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'a-first-application-1' } });
    expect(mine.status).toBe(201);

    expect((await call(me.DELETE, '/api/v1/me', { token: a.token, method: 'DELETE', body: { pin: '9999', confirm: true } })).status).toBe(401);
    expect((await call(me.DELETE, '/api/v1/me', { token: a.token, method: 'DELETE', body: { pin: a.pin } })).status).toBe(422); // no confirmation
    const del = await call(me.DELETE, '/api/v1/me', { token: a.token, method: 'DELETE', body: { pin: a.pin, confirm: true } });
    expect(del.status, JSON.stringify(del.body)).toBe(200);

    expect(await t.db.select({ id: users.id }).from(users).where(eq(users.id, ua!.id))).toHaveLength(0);
    expect(await t.db.select({ id: citizens.id }).from(citizens).where(eq(citizens.id, ca!.id))).toHaveLength(0);
    expect(await t.db.select({ id: consentsT.id }).from(consentsT).where(eq(consentsT.citizenId, ca!.id))).toHaveLength(0);
    expect(await t.db.select({ id: casesT.id }).from(casesT).where(eq(casesT.citizenId, ca!.id))).toHaveLength(0);
    // B and the seeded Zarina are untouched
    expect(await t.db.select({ id: casesT.id }).from(casesT).where(eq(casesT.id, caseB))).toHaveLength(1);
    expect(await t.db.select({ id: users.id }).from(users).where(eq(users.phone, '+920000000001'))).toHaveLength(1);
    // the old token no longer opens anything
    expect((await call(me.GET, '/api/v1/me', { token: a.token })).status).toBe(401);
    // her account's audit trail keeps ids only
    const trail = JSON.stringify(await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'account.delete')));
    expect(trail).not.toMatch(/Citizen A|3451110011/);
  });

  it('purge-whatsapp removes every account made with a real number and leaves the seeded fictional ones', async () => {
    const before = await t.db.select({ id: users.id }).from(users).where(and(eq(users.kind, 'citizen'), isNotNull(users.phoneHash)));
    expect(before.length).toBeGreaterThan(0);
    const n = await purgeWhatsappAccounts(t.db);
    expect(n).toBe(before.length);
    expect(await t.db.select({ id: users.id }).from(users).where(isNotNull(users.phoneHash))).toHaveLength(0);
    expect(await t.db.select({ id: citizens.id }).from(citizens).where(eq(citizens.id, caseB))).toHaveLength(0);
    expect((await t.db.select({ id: users.id }).from(users).where(eq(users.kind, 'citizen'))).length).toBeGreaterThanOrEqual(3); // Zarina, Fatima, Rukhsana remain
  });
});
