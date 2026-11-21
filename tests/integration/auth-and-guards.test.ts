import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as login from '../../app/api/v1/auth/login/route';
import * as otpRequest from '../../app/api/v1/auth/otp/request/route';
import * as otpVerify from '../../app/api/v1/auth/otp/verify/route';
import * as pinVerify from '../../app/api/v1/auth/pin/verify/route';
import * as me from '../../app/api/v1/me/route';
import * as casesRoute from '../../app/api/v1/cases/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as mockRoute from '../../app/api/mock/[...path]/route';
import { auditEvents, citizens, consents, mockSmsMessages } from '@/db/schema/all';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { call, seededDb, TEST_PASSWORD, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

let t: TestDb & { ids: { citizenIds: Record<string, string> } };
beforeAll(async () => { t = await seededDb(); });
afterAll(async () => { await t.close(); });
beforeEach(() => resetMemoryRateLimits());

const staff = async (email: string) => {
  const r = await call(login.POST, '/api/v1/auth/login', { body: { email, password: TEST_PASSWORD } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.token as string;
};

async function citizenToken(phone: string) {
  const req = await call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone } });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  // the code is only in the mock SMS inbox
  const inbox = await call(mockRoute.GET, '/api/mock/sms/inbox', { params: { path: ['sms', 'inbox'] }, query: { phone } });
  const code = String(inbox.body.messages[0].body).match(/code is (\d{6})/)![1]!;
  const v = await call(otpVerify.POST, '/api/v1/auth/otp/verify', { body: { phone, code } });
  expect(v.status).toBe(200);
  expect(v.body.stage).toBe('otp');
  const p = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: v.body.token, body: { pin: TEST_PIN } });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return { otpToken: v.body.token as string, token: p.body.token as string };
}

describe('every role signs in', () => {
  it.each([
    ['officer.imran@sindh.amanat.test', 'officer'],
    ['admin.sana@sindh.amanat.test', 'admin'],
    ['auditor.raza@sindh.amanat.test', 'auditor'],
    ['helper.shabana@sindh.amanat.test', 'helper'],
    ['officer.bilal@punjab.amanat.test', 'officer'],
    ['admin.breakit@sandbox.amanat.test', 'admin'],
  ])('%s → %s', async (email, role) => {
    const token = await staff(email);
    const r = await call(me.GET, '/api/v1/me', { token });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe(role);
  });

  it('citizen: phone code via the mock inbox, then PIN', async () => {
    const { otpToken, token } = await citizenToken('+920000000001');
    // nothing personal before the PIN
    const before = await call(me.GET, '/api/v1/me', { token: otpToken });
    expect(before.body.stage).toBe('otp');
    expect(before.body.trustPictureId).toBeNull();
    const after = await call(me.GET, '/api/v1/me', { token });
    expect(after.body).toMatchObject({ role: 'citizen', stage: 'full', trustPictureId: 20 });
    // the mock SMS only ever went to the fictional number
    const sent = await t.db.select().from(mockSmsMessages);
    expect(sent.every((m) => m.toPhone.startsWith('+9200000'))).toBe(true);
  });

  it('wrong password is a 401 problem document with a request id', async () => {
    const r = await call(login.POST, '/api/v1/auth/login', { body: { email: 'officer.imran@sindh.amanat.test', password: 'wrong-password-1' } });
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.body).toMatchObject({ type: 'https://amanat.example/problems/unauthenticated', status: 401, code: 'UNAUTHENTICATED' });
    expect(r.body.requestId).toBe(r.headers.get('x-request-id'));
  });

  it('rejects a tampered token', async () => {
    const token = await staff('officer.imran@sindh.amanat.test');
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    payload.app_role = 'admin';
    const forged = [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
    expect((await call(me.GET, '/api/v1/me', { token: forged })).status).toBe(401);
  });
});

describe('PIN lockout (AUTH-3)', () => {
  it('locks for 15 minutes after 5 wrong tries, even for the right PIN', async () => {
    const { otpToken } = await citizenToken('+920000000002');
    for (let i = 1; i <= 4; i++) {
      const r = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: otpToken, body: { pin: '0000' } });
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'PIN_INVALID', attemptsLeft: 5 - i });
    }
    const fifth = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: otpToken, body: { pin: '0000' } });
    expect(fifth.status).toBe(423);
    expect(fifth.body.code).toBe('PIN_LOCKED');
    const right = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: otpToken, body: { pin: TEST_PIN } });
    expect(right.status).toBe(423);
    const [c] = await t.db.select().from(citizens).where(eq(citizens.id, t.ids.citizenIds['+920000000002']!));
    const minutes = (c!.pinLockedUntil!.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    // unlock for later tests
    await t.db.update(citizens).set({ pinLockedUntil: null, pinFailedAttempts: 0 }).where(eq(citizens.id, c!.id));
  });
});

describe('rate limits', () => {
  it('OTP: 3 per phone per 10 minutes, then 429 with Retry-After', async () => {
    const phone = '+920000000099';
    for (let i = 0; i < 3; i++) expect((await call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone } })).status).toBe(202);
    const r = await call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone } });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.headers.get('ratelimit-remaining')).toBe('0');
  });

  it('rejects real-looking phone numbers', async () => {
    const r = await call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone: '+923001234567' } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('cases: idempotency, tenants, grants and consent', () => {
  let officerSindh: string;
  let officerPunjab: string;
  let caseId: string;
  const newCase = (token: string, key?: string, clientSubmissionId = 'sub-0001-zarina') =>
    call(casesRoute.POST, '/api/v1/cases', { token, headers: key ? { 'idempotency-key': key } : {}, body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId } });

  beforeAll(async () => {
    officerSindh = await staff('officer.imran@sindh.amanat.test');
    officerPunjab = await staff('officer.bilal@punjab.amanat.test');
  });

  it('a create without Idempotency-Key is 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const { token } = await citizenToken('+920000000001');
    const r = await newCase(token);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(r.body.detail).toContain('Idempotency-Key:');
  });

  it('the same key 5 times in parallel creates exactly one case and replays the first answer', async () => {
    const { token } = await citizenToken('+920000000001');
    const key = '6f1c2a7e-3b4d-4c55-9a10-2f8e7d1b0c99';
    const all = await Promise.all(Array.from({ length: 5 }, () => newCase(token, key)));
    const ids = new Set(all.map((r) => r.body.id));
    caseId = [...ids][0];
    expect(ids.size).toBe(1);
    // replays return the stored response (same 201 and body), flagged by the header
    expect(all.every((r) => r.status === 201)).toBe(true);
    expect(all.filter((r) => r.headers.get('idempotent-replayed') === 'true')).toHaveLength(4);
    const creates = await t.db.select().from(auditEvents).where(sql`${auditEvents.action} = 'case.create'`);
    expect(creates).toHaveLength(1);
    // the same client submission under a new key is still the same case (OFF-4)
    const again = await newCase(token, 'another-key-0001');
    expect(again.body.id).toBe(caseId);
  });

  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { token } = await citizenToken('+920000000001');
    const r = await newCase(token, '6f1c2a7e-3b4d-4c55-9a10-2f8e7d1b0c99', 'sub-0002-other');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it("another tenant's case is a 404 identical to an unknown id; the audit log records TENANT_MISMATCH", async () => {
    const other = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: officerPunjab, params: { id: caseId } });
    const unknown = await call(caseById.GET, '/api/v1/cases/00000000-0000-4000-8000-000000000000', { token: officerPunjab, params: { id: '00000000-0000-4000-8000-000000000000' } });
    expect(other.status).toBe(404);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(other.body)).toEqual(strip(unknown.body));
    const ev = await t.db.select().from(auditEvents).where(sql`${auditEvents.details}->>'reason' = 'TENANT_MISMATCH'`);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0]!.outcome).toBe('denied');
  });

  it('own-tenant officer with consent reads the case, masked CNIC, and the read is audited', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: officerSindh, params: { id: caseId } });
    expect(r.status).toBe(200);
    expect(r.body.citizen.cnic).toBe('00000-XXXX567-2');
    expect(r.body.ticks).toBe('blue2');
    const reads = await t.db.select().from(auditEvents).where(sql`${auditEvents.action} = 'case.read' and ${auditEvents.outcome} = 'allowed'`);
    expect(reads.some((e) => e.subjectCitizenId === t.ids.citizenIds['+920000000001'])).toBe(true);
  });

  it('auditor sees masked personal fields', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: await staff('auditor.raza@sindh.amanat.test'), params: { id: caseId } });
    expect(r.status).toBe(200);
    expect(r.body.citizen.name).toBeNull();
    expect(r.body.citizen.dob).toBeNull();
  });

  it('admin may not read cases (FORBIDDEN_ROLE)', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: await staff('admin.sana@sindh.amanat.test'), params: { id: caseId } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('helper without a live unlock gets 403 GRANT_REQUIRED', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: await staff('helper.shabana@sindh.amanat.test'), params: { id: caseId } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('GRANT_REQUIRED');
  });

  it('after consent is withdrawn the officer gets 403 CONSENT_WITHDRAWN, logged against the citizen', async () => {
    const citizenId = t.ids.citizenIds['+920000000001']!;
    await t.db.update(consents).set({ status: 'withdrawn', withdrawnAt: new Date() }).where(eq(consents.citizenId, citizenId));
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: officerSindh, params: { id: caseId } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CONSENT_WITHDRAWN');
    const denied = await t.db.select().from(auditEvents).where(sql`${auditEvents.details}->>'code' = 'CONSENT_WITHDRAWN'`);
    expect(denied.at(-1)!.subjectCitizenId).toBe(citizenId);
    await t.db.update(consents).set({ status: 'active', withdrawnAt: null }).where(eq(consents.citizenId, citizenId));
  });

  it('unauthenticated is 401', async () => {
    const r = await call(caseById.GET, `/api/v1/cases/${caseId}`, { params: { id: caseId } });
    expect(r.status).toBe(401);
  });
});
