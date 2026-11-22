/** Dashboard (task progress, status and history): citizen list + timeline, helper family status, officer queue counts. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { citizens, users } from '@/db/schema/all';
import * as myCases from '../../app/api/v1/me/cases/route';
import * as timeline from '../../app/api/v1/cases/[id]/timeline/route';
import * as families from '../../app/api/v1/helper/families/route';
import * as queue from '../../app/api/v1/queue/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
const citizen = async (phone: string) => {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone));
  return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
};
const staff = (email: string, role: 'officer' | 'helper', tid: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid });

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; });
afterAll(async () => { await t?.close(); });

describe('dashboard: status, ticks and history', () => {
  it('the citizen sees her applications with status and ticks, and each one\'s own timeline only', async () => {
    const fatima = await citizen('+920000000002');
    const list = await call(myCases.GET, '/api/v1/me/cases', { token: fatima });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    for (const c of list.body.items) {
      expect(typeof c.status).toBe('string');
      expect(['grey1', 'grey2', 'blue2', 'failed']).toContain(c.ticks);
    }
    const mine = list.body.items.find((c: { status: string }) => c.status !== 'draft');
    const tl = await call(timeline.GET, `/api/v1/cases/${mine.id}/timeline`, { token: fatima, params: { id: mine.id } });
    expect(tl.status).toBe(200);
    expect(tl.body.view).toBe('citizen');
    expect(tl.body.events.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(tl.body)).not.toMatch(/actor|details|\d{5}-\d{7}-\d/); // simplified, no staff names or ids

    // another citizen: her list is her own, and Fatima's timeline is a 404
    const zarina = await citizen('+920000000001');
    const other = await call(myCases.GET, '/api/v1/me/cases', { token: zarina });
    expect(other.body.items.some((c: { id: string }) => c.id === mine.id)).toBe(false);
    expect((await call(timeline.GET, `/api/v1/cases/${mine.id}/timeline`, { token: zarina, params: { id: mine.id } })).status).toBe(404);
  });

  it('the helper sees each family\'s status and ticks; the officer queue shows counts', async () => {
    const helper = await staff('helper.shabana@sindh.amanat.test', 'helper', t.ids.tenantIds['sindh']!);
    const f = await call(families.GET, '/api/v1/helper/families', { token: helper });
    expect(f.status).toBe(200);
    const withCase = f.body.families.filter((x: { case: unknown }) => x.case);
    expect(withCase.length).toBeGreaterThanOrEqual(1);
    for (const x of withCase) { expect(typeof x.case.status).toBe('string'); expect(['grey1', 'grey2', 'blue2']).toContain(x.case.ticks); }

    const officer = await staff('officer.imran@sindh.amanat.test', 'officer', t.ids.tenantIds['sindh']!);
    const q = await call(queue.GET, '/api/v1/queue', { token: officer });
    expect(q.status).toBe(200);
    expect(q.body.countsByStop).toBeTypeOf('object');
    expect(q.body.items.length).toBeGreaterThanOrEqual(1);
    // another office's officer sees none of these cases
    const punjab = await staff('officer.bilal@punjab.amanat.test', 'officer', t.ids.tenantIds['punjab']!);
    const pq = await call(queue.GET, '/api/v1/queue', { token: punjab });
    const ids = new Set(q.body.items.map((i: { id: string }) => i.id));
    expect(pq.body.items.every((i: { id: string }) => !ids.has(i.id))).toBe(true);
  });
});
