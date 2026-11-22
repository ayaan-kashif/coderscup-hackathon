/** AU3: the auditor's read-only log of every data read (allowed and denied) with export; role, tenant and consent. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { citizens, users } from '@/db/schema/all';
import { toCsv } from '@/services/org';
import * as readsRoute from '../../app/api/v1/audit/reads/route';
import * as accessRoute from '../../app/api/v1/audit/access/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as withdraw from '../../app/api/v1/me/consents/[id]/withdraw/route';
import * as consentsRoute from '../../app/api/v1/me/consents/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
let sindh: string, punjab: string;
const staff = (email: string, role: 'officer' | 'admin' | 'auditor', tid: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid });

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; sindh = t.ids.tenantIds['sindh']!; punjab = t.ids.tenantIds['punjab']!; });
afterAll(async () => { await t?.close(); });

describe('AU3 every data read, allowed and denied, with export', () => {
  it('lists reads for auditors only, scoped to the office, with a denied read after consent is withdrawn', async () => {
    const officer = await staff('officer.imran@sindh.amanat.test', 'officer', sindh);
    const auditor = await staff('auditor.raza@sindh.amanat.test', 'auditor', sindh);
    const [f] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, '+920000000002')).limit(1);
    const fatima = await signAccessToken({ sub: f!.id, kind: 'citizen', app_role: 'citizen', cid: f!.cid, stage: 'full' });
    const list = await call(consentsRoute.GET, '/api/v1/me/consents', { token: fatima });
    const active = list.body.consents.find((c: { status: string }) => c.status === 'active');
    const q = await t.db.execute(`select id from cases where citizen_id = '${f!.cid}' limit 1`).then((r) => (r as unknown as { rows: { id: string }[] }).rows[0]!.id);

    expect((await call(caseById.GET, `/api/v1/cases/${q}`, { token: officer, params: { id: q } })).status).toBe(200); // an allowed read
    expect((await call(withdraw.POST, `/api/v1/me/consents/${active.id}/withdraw`, { token: fatima, params: { id: active.id }, body: { pin: '2580', heardWarning: true } })).status).toBe(200);
    expect((await call(caseById.GET, `/api/v1/cases/${q}`, { token: officer, params: { id: q } })).status).toBe(403); // a refused read

    const all = await call(readsRoute.GET, '/api/v1/audit/reads', { token: auditor });
    expect(all.status).toBe(200);
    expect(all.body.items.some((e: { outcome: string; action: string }) => e.outcome === 'allowed' && e.action === 'case.read')).toBe(true);
    expect(all.body.denied).toBeGreaterThanOrEqual(1);
    const denied = await call(readsRoute.GET, '/api/v1/audit/reads', { token: auditor, query: { outcome: 'denied' } });
    expect(denied.body.items.length).toBeGreaterThanOrEqual(1);
    expect(denied.body.items.every((e: { outcome: string }) => e.outcome === 'denied')).toBe(true);
    expect(JSON.stringify(all.body)).not.toMatch(/\d{5}-\d{7}-\d/); // no CNIC in the log

    // roles and tenants
    expect((await call(readsRoute.GET, '/api/v1/audit/reads', { token: officer })).status).toBe(403);
    const otherAuditor = await staff('auditor.kamran@punjab.amanat.test', 'auditor', punjab);
    const theirs = await call(readsRoute.GET, '/api/v1/audit/reads', { token: otherAuditor });
    expect(theirs.status).toBe(200);
    expect(theirs.body.items.some((e: { citizenId: string }) => e.citizenId === f!.cid)).toBe(false);
  });

  it('exports CSV with a download header, formula cells neutralised, and the per-citizen view exports too', async () => {
    const auditor = await staff('auditor.raza@sindh.amanat.test', 'auditor', sindh);
    const csv = await call(readsRoute.GET, '/api/v1/audit/reads', { token: auditor, query: { format: 'csv' } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect(csv.headers.get('content-disposition')).toMatch(/attachment; filename="amanat-data-reads-/);
    expect(csv.text.split('\r\n')[0]).toBe('seq,ts,actorType,actorId,action,resourceType,resourceId,citizenId,outcome,code');
    const out = toCsv([{ a: '=HYPERLINK("x")', b: 'a,b', c: 'say "hi"' }], ['a', 'b', 'c']).split('\r\n')[1]!;
    expect(out.startsWith('"\'=HYPERLINK(')).toBe(true); // prefixed with a quote so a spreadsheet will not run it
    expect(out).toContain(',"a,b","say ""hi"""');

    const [f] = await t.db.select({ cid: citizens.id }).from(citizens).limit(1);
    const one = await call(accessRoute.GET, '/api/v1/audit/access', { token: auditor, query: { citizenId: f!.cid, format: 'csv' } });
    expect(one.status).toBe(200);
    expect(one.text.split('\r\n')[0]).toBe('kind,ts,what,who,outcome');
    const officer = await staff('officer.imran@sindh.amanat.test', 'officer', sindh);
    expect((await call(accessRoute.GET, '/api/v1/audit/access', { token: officer, query: { citizenId: f!.cid, format: 'csv' } })).status).toBe(403);
  });
});
