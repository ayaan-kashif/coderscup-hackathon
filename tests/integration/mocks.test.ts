import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as mockRoute from '../../app/api/mock/[...path]/route';
import { chaosSettings, mockIdentityRecords, mockIssuerKeys, mockWallets } from '@/db/schema/all';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { breaker, identityRegistry, paymentLedger, resetBreakers } from '@/services/adapters';
import { ApiError } from '@/lib/errors';
import { call, seededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

let t: TestDb;
beforeAll(async () => {
  t = await seededDb();
  await t.db.insert(mockIdentityRecords).values([
    { id: 'NR-1', cnic: '00000-1234567-2', name: 'ZARINA BIBI', relationName: 'MUHAMMAD ASLAM', relation: 'husband', dob: '1972-03-14', gender: 'F', districtCode: 'BDN' },
    { id: 'NR-2', cnic: '00000-7654321-4', name: 'FATIMA BIBI', relationName: 'ALLAH DITTA', relation: 'husband', dob: '1968-11-02', gender: 'F', districtCode: 'BDN' },
  ]);
  await t.db.insert(mockWallets).values({ id: 'W-1', walletNo: 'PK00MOCK0000000001', provider: 'MockPay', holderCnic: '00000-1234567-2', holderName: 'ZARINA BIBI' });
  await t.db.insert(mockIssuerKeys).values({ kid: 'mock-issuer-2026', publicKey: 'AAAA' });
});
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  resetMemoryRateLimits();
  resetBreakers();
  await t.db.update(chaosSettings).set({ latencyMs: 0, timeoutRate: 0, errorRate: 0 });
});

const get = (path: string[], query?: Record<string, string>) => call(mockRoute.GET, `/api/mock/${path.join('/')}`, { params: { path }, query });
const post = (path: string[], body: unknown) => call(mockRoute.POST, `/api/mock/${path.join('/')}`, { params: { path }, body });

describe('six mock services respond, labelled simulated', () => {
  it.each([
    ['identity', () => get(['identity', '00000-1234567-2'])],
    ['identity search', () => post(['identity', 'search'], { name: 'Zarina Bibi', districtCode: 'BDN' })],
    ['civil death', () => get(['civil', 'death'], { cnic: '00000-1234567-2' })],
    ['civil marriage', () => get(['civil', 'marriage'], { cnic: '00000-1234567-2' })],
    ['ledger list', () => get(['ledger', 'payments'], { cnic: '00000-1234567-2' })],
    ['sms send', () => post(['sms', 'send'], { to: '+920000000001', body: 'hello' })],
    ['sms inbox', () => get(['sms', 'inbox'], { phone: '+920000000001' })],
    ['ivr call', () => post(['ivr', 'call'], { to: '+920000000001', script: 'Payout change requested', objectionDigit: '9' })],
    ['complaints', () => post(['complaints'], { type: 'deduction', summary: 'received less' })],
    ['issuer keys', () => get(['issuer', 'keys'])],
  ])('%s', async (_n, fn) => {
    const r = await fn();
    expect(r.status).toBeLessThan(300);
    expect(r.body.simulated).toBe(true);
    expect(r.headers.get('x-simulated')).toBe('true');
  });

  it('identity search finds a CNIC one digit off', async () => {
    const r = await post(['identity', 'search'], { cnic: '00000-1234568-2' });
    expect(r.body.candidates.map((c: { id: string }) => c.id)).toContain('NR-1');
  });

  it('ledger POST is idempotent by key and never moves money', async () => {
    const body = { walletNo: 'PK00MOCK0000000001', recipientCnic: '00000-1234567-2', programCode: 'SAAYA-WS', amount: 12000, idempotencyKey: 'pay-key-000001' };
    const a = await post(['ledger', 'payments'], body);
    const b = await post(['ledger', 'payments'], body);
    expect(a.status).toBe(201);
    expect(b.body.payment.ref).toBe(a.body.payment.ref);
  });
});

describe('chaos settings (ADM-2)', () => {
  it('error rate 1 → 503 DEPENDENCY_UNAVAILABLE', async () => {
    await t.db.update(chaosSettings).set({ errorRate: 1 }).where(eq(chaosSettings.service, 'identity'));
    const r = await get(['identity', '00000-1234567-2']);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', simulated: true, chaos: 'error' });
  });

  it('latency is applied', async () => {
    await t.db.update(chaosSettings).set({ latencyMs: 150 }).where(eq(chaosSettings.service, 'issuer'));
    const start = Date.now();
    await get(['issuer', 'keys']);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  it('timeout rate 1 → the adapter times out at 3 s, retries, opens the circuit, and fails safe', async () => {
    await t.db.update(chaosSettings).set({ timeoutRate: 1 }).where(eq(chaosSettings.service, 'identity'));
    const started = Date.now();
    const err = await identityRegistry.byCnic('00000-1234567-2').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('DEPENDENCY_UNAVAILABLE');
    // 4 attempts x 3 s, plus backoff
    expect(Date.now() - started).toBeGreaterThanOrEqual(11_500);
    expect(breaker('identity').snapshot().recentFailures).toBe(4);
    await identityRegistry.byCnic('00000-1234567-2').catch(() => {});
    expect(breaker('identity').state).toBe('open');
    const fast = Date.now();
    const again = await identityRegistry.byCnic('00000-1234567-2').catch((e) => e);
    expect((again as ApiError).extra.reason).toBe('circuit open');
    expect(Date.now() - fast).toBeLessThan(500);
  }, 60_000);

  it('adapters validate and return data when healthy', async () => {
    const r = await paymentLedger.list({ cnic: '00000-1234567-2' });
    expect(r.status).toBe(200);
    expect(r.data?.simulated).toBe(true);
  });
});
