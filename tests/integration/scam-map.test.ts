/**
 * Scam Map (PRD F12 / SCAM-5): counts under 3 are masked by the server, days and type are honoured, the spike rule
 * is the alert job's rule, offices stay sealed and nothing identifies a person.
 */
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as scamMap from '../../app/api/v1/scam/map/route';
import { signAccessToken } from '@/auth/tokens';
import { districts, scamReports } from '@/db/schema/all';
import { aiOff, aiReset } from '../helpers/ai';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 120_000 });

type Ids = { staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
const tok: Record<string, string> = {};
type D = { code: string; count: number | null; underThreshold: boolean; countToday: number | null; series: { day: string; count: number | null }[]; byType: Record<string, number | null>; spike: boolean; alert: { id: string; status: string } | null; total: number | string; lat: number; lng: number };
const get = async (query: Record<string, string> = {}, token?: string) => (await call(scamMap.GET, '/api/v1/scam/map', { query, token })).body.districts as D[];
const row = (ds: D[], code: string) => ds.find((d) => d.code === code)!;
const staff = (email: string, role: 'officer', tenant: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]! });

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  tok.imran = await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh');
  tok.bilal = await staff('officer.bilal@punjab.amanat.test', 'officer', 'punjab');
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });

async function addFakes(code: string, n: number, type = 'fee_before_payment', ageMs = 60_000) {
  const [d] = await t.db.select({ id: districts.id, tenantId: districts.tenantId }).from(districts).where(eq(districts.code, code));
  for (let i = 0; i < n; i++) {
    await t.db.insert(scamReports).values({ tenantId: d!.tenantId, districtId: d!.id, messageHash: `seed-test-${code}-${type}-${i}-${ageMs}`, messageText: '(test)', channel: 'text', verdict: 'fake', scamType: type, extractedClaims: {}, createdAt: new Date(Date.now() - ageMs - i * 1000) });
  }
}

describe('GET /api/v1/scam/map', () => {
  it('keeps the old fields and adds the new ones, with position and no personal data', async () => {
    const ds = await get();
    const hyd = row(ds, 'HYD');
    expect(hyd.total).toBeGreaterThanOrEqual(5); // legacy field still a number from 3 up
    expect(hyd.count).toBe(hyd.total);
    expect(hyd.lat).toBeCloseTo(25.396, 2);
    expect(hyd.lng).toBeCloseTo(68.377, 2);
    expect(Object.keys(hyd).sort()).toEqual(expect.arrayContaining(['alert', 'byType', 'code', 'count', 'countToday', 'days', 'lat', 'lng', 'name', 'series', 'spike', 'today', 'topType', 'total', 'underThreshold']));
    expect(JSON.stringify(ds)).not.toMatch(/\+92|00000-|synthetic|Rs \d/);
  });

  it('never returns a count under 3: null plus underThreshold, in every field', async () => {
    const ds = await get();
    const low = ds.filter((d) => d.underThreshold);
    expect(low.length).toBeGreaterThan(0); // RJP, THP, BWP, BDN are seeded with fewer than 3
    for (const d of low) {
      expect(d.count).toBeNull();
      expect(d.countToday).toBeNull();
      expect(d.total).toBe('fewer than 3');
      expect(d.series.every((s) => s.count === null)).toBe(true);
      expect(Object.values(d.byType).every((v) => v === null)).toBe(true);
    }
    for (const d of ds) {
      for (const v of [d.count, d.countToday, ...d.series.map((s) => s.count), ...Object.values(d.byType)]) expect(v === null || v >= 3).toBe(true);
    }
  });

  it('honours days: today is a subset of 7 days, which is a subset of 30', async () => {
    await addFakes('LHR', 4, 'lottery_prize', 20 * 86_400_000); // 20 days old
    const [d1, d7, d30] = [await get({ days: '1' }), await get({ days: '7' }), await get({ days: '30' })];
    expect(row(d1, 'LHR').series).toHaveLength(1);
    expect(row(d7, 'LHR').series).toHaveLength(7);
    expect(row(d30, 'LHR').series).toHaveLength(30);
    const n = (ds: D[]) => row(ds, 'LHR').count ?? 0;
    expect(n(d30)).toBeGreaterThanOrEqual(n(d7) + 4);
    expect(n(d7)).toBeGreaterThanOrEqual(n(d1));
  });

  it('honours type: only that type is counted, and an unknown type is refused', async () => {
    await addFakes('KHS', 6, 'impersonation_call');
    const all = row(await get({ type: 'all' }), 'KHS').count!;
    const one = row(await get({ type: 'impersonation_call' }), 'KHS');
    expect(one.count).toBeLessThan(all);
    expect(one.count).toBeGreaterThanOrEqual(6);
    expect(row(await get({ type: 'lottery_prize' }), 'KHS').count).toBeNull(); // KHS has none of these
    const bad = await call(scamMap.GET, '/api/v1/scam/map', { query: { type: 'bogus' } });
    expect(bad.status).toBe(422);
  });

  it('flags a spike with the alert job rule: today ≥ 5 and ≥ 3× the previous 7-day average', async () => {
    const before = row(await get(), 'MUL');
    expect(before.spike).toBe(false);
    await addFakes('MUL', 5, 'fake_approval_link', 60_000);
    expect(row(await get(), 'MUL').spike).toBe(true);
    // a district with a busy week does not spike on 5: previous days average 3 → needs ≥ 9 today
    await addFakes('FSD', 5, 'fee_before_payment', 60_000);
    for (let d = 1; d <= 7; d++) await addFakes('FSD', 3, 'lottery_prize', d * 86_400_000 + 3_600_000);
    expect(row(await get(), 'FSD').spike).toBe(false);
  });

  it('spike is judged on every type even when a type filter is set', async () => {
    const f = row(await get({ type: 'lottery_prize' }), 'MUL');
    expect(f.spike).toBe(true);
  });

  it('keeps the Hyderabad demo seed: 4 today, so one live report makes the 5th and triggers the spike', async () => {
    const [d] = await t.db.select({ id: districts.id }).from(districts).where(eq(districts.code, 'HYD'));
    const seeded = await t.db.select({ createdAt: scamReports.createdAt }).from(scamReports).where(and(eq(scamReports.districtId, d!.id), like(scamReports.messageHash, 'seed-%'), eq(scamReports.verdict, 'fake')));
    expect(seeded.filter((r) => !r.createdAt || Date.now() - r.createdAt.getTime() < 86_400_000)).toHaveLength(4);
    expect(row(await get(), 'HYD').spike).toBe(false);
    await addFakes('HYD', 1, 'fee_before_payment', 1000);
    const hyd = row(await get(), 'HYD');
    expect(hyd.spike).toBe(true);
    expect(hyd.countToday).toBe(5);
  });
});

describe('offices stay sealed', () => {
  it('a Punjab officer gets no Sindh districts and a Sindh officer no Punjab ones', async () => {
    const pj = (await get({}, tok.bilal)).map((d) => d.code).sort();
    const sd = (await get({}, tok.imran)).map((d) => d.code).sort();
    expect(pj).toEqual(['BWP', 'FSD', 'LHR', 'MUL', 'RJP']);
    expect(sd).toEqual(['BDN', 'HYD', 'KHS', 'SKR', 'THP', 'TTA']);
  });

  it('the public map shows every district and never an alert id; an officer sees only own drafted alerts', async () => {
    const pub = await get();
    expect(pub.length).toBe(11);
    expect(pub.every((d) => d.alert === null)).toBe(true);
    const [h] = await t.db.select({ id: districts.id, tenantId: districts.tenantId }).from(districts).where(eq(districts.code, 'HYD'));
    const { scamAlerts } = await import('@/db/schema/all');
    const [a] = await t.db.insert(scamAlerts).values({ tenantId: h!.tenantId!, districtId: h!.id, scamType: 'fee_before_payment', count: 5, windowStart: new Date() }).returning({ id: scamAlerts.id });
    const own = row(await get({}, tok.imran), 'HYD');
    expect(own.alert).toEqual({ id: a!.id, status: 'draft' });
    expect((await get({}, tok.bilal)).some((d) => d.alert)).toBe(false);
  });
});
