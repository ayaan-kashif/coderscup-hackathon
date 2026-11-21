/**
 * PRD §26.1 Security: JWT tampering, IDOR, CSRF, revoked sessions and keys, rate limits, injection in queries,
 * no secrets in the repository, security headers configured. Every probe must be refused.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as auditEvents from '../../app/api/v1/audit/events/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as casesRoute from '../../app/api/v1/cases/route';
import * as me from '../../app/api/v1/me/route';
import * as otpRequest from '../../app/api/v1/auth/otp/request/route';
import * as receipt from '../../app/api/v1/payments/[id]/receipt/route';
import * as scamCheck from '../../app/api/v1/scam/check/route';
import { apiKeyHash } from '@/auth/crypto';
import { signAccessToken } from '@/auth/tokens';
import { apiKeys, citizens, payments, users } from '@/db/schema/all';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { call, seededDb, idem } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

type Ids = { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
let zarina = '';
let fatimaPayment = '';
beforeAll(async () => {
  t = await seededDb() as never;
  const [u] = await t.db.select({ id: users.id }).from(citizens).innerJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, t.ids.citizenIds['+920000000001']!)).limit(1);
  zarina = await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: t.ids.citizenIds['+920000000001']!, stage: 'full' });
  // a payment that belongs to Fatima
  const { createDraftCase } = await import('@/services/cases');
  const fatima = t.ids.citizenIds['+920000000002']!;
  const { row } = await createDraftCase(t.db, { actor: { kind: 'system', id: 'probe', role: 'citizen', citizenId: fatima }, tenantId: t.ids.tenantIds.sindh!, citizenId: fatima, programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'probe-fatima-0001' });
  const [p] = await t.db.insert(payments).values({ caseId: row.id, tenantId: t.ids.tenantIds.sindh!, amount: 12000, status: 'sent' }).returning({ id: payments.id });
  fatimaPayment = p!.id;
}, 120_000);
afterAll(async () => { await t.close(); });

describe('token tampering', () => {
  it('alg "none", a forged signature, a foreign key and an expired token are all 401', async () => {
    const [head, body] = zarina.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${body}.`;
    const flipped = `${head}.${body}.${'A'.repeat(43)}`;
    const elevated = `${head}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), app_role: 'admin' })).toString('base64url')}.${zarina.split('.')[2]}`;
    const foreign = await new SignJWT({ sub: 'x', app_role: 'admin', role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('not-our-secret-not-our-secret-123456'));
    const expired = await signAccessToken({ sub: 'x', kind: 'citizen', app_role: 'citizen', stage: 'full' }, Math.floor(Date.now() / 1000) - 3600);
    for (const token of [none, flipped, elevated, foreign, expired]) {
      const r = await call(me.GET, '/api/v1/me', { token });
      expect(r.status, token.slice(0, 20)).toBe(401);
    }
  });
});

describe('IDOR and ownership', () => {
  it("a citizen cannot confirm another citizen's payment (404, not 403: nothing is revealed)", async () => {
    const r = await call(receipt.POST, `/api/v1/payments/${fatimaPayment}/receipt`, { token: zarina, params: { id: fatimaPayment }, headers: idem(), body: { received: 'all' } });
    expect(r.status).toBe(404);
  });
  it('a citizen cannot create a case for someone else (citizenId in the body is ignored)', async () => {
    resetMemoryRateLimits();
    const r = await call(casesRoute.POST, '/api/v1/cases', { token: zarina, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'probe-idor-0001', citizenId: t.ids.citizenIds['+920000000002'] } });
    expect(r.status).toBe(201);
    const v = await call(caseById.GET, `/api/v1/cases/${r.body.id}`, { token: zarina, params: { id: r.body.id } });
    expect(v.body.citizen.id).toBe(t.ids.citizenIds['+920000000001']);
  });
});

describe('sessions, keys and CSRF', () => {
  it('revoked sessions and revoked API keys are refused', async () => {
    const officerId = t.ids.staffIds['officer.imran@sindh.amanat.test']!;
    const token = await signAccessToken({ sub: officerId, kind: 'staff', app_role: 'officer', tid: t.ids.tenantIds.sindh! }, Math.floor(Date.now() / 1000) - 5);
    await t.db.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, officerId));
    expect((await call(me.GET, '/api/v1/me', { token })).status).toBe(401);
    const key = `amk_probe001_${'p'.repeat(30)}`;
    await t.db.insert(apiKeys).values({ tenantId: t.ids.tenantIds.sindh!, name: 'probe', prefix: 'probe001', keyHash: apiKeyHash(key), scopes: ['scam:check'], revokedAt: new Date() });
    expect((await call(me.GET, '/api/v1/me', { apiKey: key })).status).toBe(401);
  });
  it('a cookie-authenticated write from another origin is refused', async () => {
    resetMemoryRateLimits();
    const r = await call(casesRoute.POST, '/api/v1/cases', { headers: { cookie: `amanat_session=${zarina}`, origin: 'https://evil.example', ...idem() }, body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'probe-csrf-0001' } });
    expect(r.status).toBe(403);
  });
});

describe('abuse', () => {
  it('OTP requests are limited (3 per phone per 10 minutes)', async () => {
    resetMemoryRateLimits();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await call(otpRequest.POST, '/api/v1/auth/otp/request', { body: { phone: '+920000000001' }, ip: `10.7.0.${i}` })).status);
    expect(codes.slice(0, 3).every((c) => c === 202)).toBe(true);
    expect(codes[3]).toBe(429);
  });
  it('anonymous scam checks are limited per IP', async () => {
    resetMemoryRateLimits();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call(scamCheck.POST, '/api/v1/scam/check', { body: { text: 'hello there friend' }, ip: '10.8.8.8' })).status;
    expect(last).toBe(429);
  });
  it('SQL-like input in search parameters is data, never code', async () => {
    resetMemoryRateLimits();
    const auditor = await signAccessToken({ sub: t.ids.staffIds['auditor.raza@sindh.amanat.test']!, kind: 'staff', app_role: 'auditor', tid: t.ids.tenantIds.sindh! });
    const r = await call(auditEvents.GET, '/api/v1/audit/events', { token: auditor, query: { action: "x' or 1=1; drop table cases; --" } });
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) expect(r.body.events).toEqual([]);
  });
});

describe('repository and configuration', () => {
  it('no secret values from .env.local and no private keys are tracked in git', () => {
    const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && !f.endsWith('.png') && !f.endsWith('.wav') && fs.existsSync(f));
    const secrets: string[] = [];
    if (fs.existsSync('.env.local')) {
      for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.{12,})$/);
        if (m && !['DEMO_MODE'].includes(m[1]!)) secrets.push(m[2]!.trim());
      }
    }
    const leaks: string[] = [];
    for (const f of tracked) {
      const s = fs.readFileSync(f, 'utf8');
      if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)) leaks.push(`${f}: private key`);
      for (const v of secrets) if (s.includes(v)) leaks.push(`${f}: a value from .env.local`);
    }
    expect(leaks).toEqual([]);
    expect(tracked).not.toContain('.env.local');
  });
  it('security headers are configured for every response', () => {
    const cfg = fs.readFileSync('next.config.ts', 'utf8');
    for (const h of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']) expect(cfg).toContain(h);
  });
});
