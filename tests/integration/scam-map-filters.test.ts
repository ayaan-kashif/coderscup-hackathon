/** SCAM-5: the Scam Map filters by time, district and scam type; every count under 3 stays hidden under any filter. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, seededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { districts, scamReports } from '@/db/schema/all';
import * as mapRoute from '../../app/api/v1/scam/map/route';

let t: TestDb & { ids: { tenantIds: Record<string, string> } };

async function report(code: string, scamType: string, daysAgo: number, n: number) {
  const [d] = await t.db.select({ id: districts.id, tenantId: districts.tenantId }).from(districts).where(eq(districts.code, code));
  for (let i = 0; i < n; i++) {
    await t.db.insert(scamReports).values({
      tenantId: d!.tenantId, districtId: d!.id, messageHash: `h-${code}-${scamType}-${daysAgo}-${i}-${Math.random()}`, channel: 'text', verdict: 'fake',
      scamType, extractedClaims: {}, createdAt: new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000),
    });
  }
}

beforeAll(async () => {
  t = await seededDb() as never;
  await report('HYD', 'fee_before_payment', 1, 4);     // 4 recent fee scams in Hyderabad
  await report('HYD', 'asks_pin_code_cnic', 2, 2);     // 2 code scams: under 3
  await report('SKR', 'fee_before_payment', 3, 5);     // 5 in Sukkur
  await report('KHS', 'fee_before_payment', 20, 6);    // 6 in Karachi South, but 20 days ago
});
afterAll(async () => { await t?.close(); });

const get = (query: Record<string, string> = {}) => call(mapRoute.GET, '/api/v1/scam/map', { query });
const row = (body: { districts: { code: string; total: number | string }[] }, code: string) => body.districts.find((d) => d.code === code);

describe('SCAM-5 Scam Map filters', () => {
  it('is public, defaults to 7 days, and returns the filter options', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.filter).toEqual({ days: 7, district: null, type: null });
    expect(r.body.options.types).toEqual(expect.arrayContaining(['fee_before_payment', 'asks_pin_code_cnic']));
    expect(row(r.body, 'SKR')!.total).toBe(5);
    expect(row(r.body, 'HYD')!.total).toBe(6);
    expect(row(r.body, 'KHS')).toBeUndefined(); // 20 days ago: outside 7 days
  });

  it('time filter widens the window', async () => {
    const r = await get({ days: '30' });
    expect(row(r.body, 'KHS')!.total).toBe(6);
    expect((await get({ days: '0' })).status).toBe(422);
    expect((await get({ days: '500' })).status).toBe(422);
  });

  it('district filter shows only that district', async () => {
    const r = await get({ district: 'SKR' });
    expect(r.body.districts.map((d: { code: string }) => d.code)).toEqual(['SKR']);
    expect((await get({ district: "SKR'; drop table x" })).status).toBe(422);
  });

  it('type filter narrows counts, and a count under 3 is hidden, not shown', async () => {
    const fee = await get({ type: 'fee_before_payment' });
    expect(row(fee.body, 'HYD')!.total).toBe(4);
    const code = await get({ type: 'asks_pin_code_cnic' });
    const hyd = row(code.body, 'HYD')!;
    expect(hyd.total).toBe('fewer than 3');
    expect(JSON.stringify(code.body)).not.toMatch(/"total":2\b/);
    const days = (hyd as unknown as { days: { count: number | string }[] }).days;
    expect(days.every((d) => d.count === 'fewer than 3')).toBe(true);
    expect(JSON.stringify(code.body)).not.toMatch(/message|hash|reporter/i);
  });
});
