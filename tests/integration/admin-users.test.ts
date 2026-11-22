/** A6: create (.test only), change role, deactivate / reactivate and revoke sessions; audited and limited to the admin's own office. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, seededDb, TEST_PASSWORD } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { auditEvents, memberships, users } from '@/db/schema/all';
import * as usersRoute from '../../app/api/v1/admin/users/route';
import * as userById from '../../app/api/v1/admin/users/[id]/route';
import * as loginRoute from '../../app/api/v1/auth/login/route';
import * as meRoute from '../../app/api/v1/me/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
let sindh: string, punjab: string;
const tok = (email: string, role: 'officer' | 'admin' | 'auditor', tid: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid });
const patch = (token: string, id: string, body: object) => call(userById.PATCH, `/api/v1/admin/users/${id}`, { method: 'PATCH', token, params: { id }, body });

beforeAll(async () => { t = await seededDb() as never; sindh = t.ids.tenantIds['sindh']!; punjab = t.ids.tenantIds['punjab']!; });
afterAll(async () => { await t?.close(); });

describe('A6 staff users', () => {
  it('creates only .test addresses, never touches an existing account, and returns the temporary password once', async () => {
    const admin = await tok('admin.sana@sindh.amanat.test', 'admin', sindh);
    const bad = await call(usersRoute.POST, '/api/v1/admin/users', { token: admin, headers: { 'idempotency-key': 'user-key-0001' }, body: { email: 'real.person@example.com', displayName: 'Someone Real', role: 'officer' } });
    expect(bad.status).toBe(422);
    const ok = await call(usersRoute.POST, '/api/v1/admin/users', { token: admin, headers: { 'idempotency-key': 'user-key-0002' }, body: { email: 'new.officer@sindh.amanat.test', displayName: 'New Officer (fictional)', role: 'officer' } });
    expect(ok.status).toBe(201);
    expect(ok.body.temporaryPassword).toMatch(/^tmp-/);
    // an address that exists in another office is refused, and that user is unchanged
    const dup = await call(usersRoute.POST, '/api/v1/admin/users', { token: admin, headers: { 'idempotency-key': 'user-key-0003' }, body: { email: 'officer.bilal@punjab.amanat.test', displayName: 'Hijacked Name', role: 'admin' } });
    expect(dup.status).toBe(409);
    const [bilal] = await t.db.select({ name: users.displayName }).from(users).where(eq(users.email, 'officer.bilal@punjab.amanat.test'));
    expect(bilal!.name).not.toBe('Hijacked Name');
    const list = await call(usersRoute.GET, '/api/v1/admin/users', { token: admin });
    expect(list.body.items.some((u: { email: string }) => u.email === 'officer.bilal@punjab.amanat.test')).toBe(false);
    // the new user can sign in with the temporary password
    const login = await call(loginRoute.POST, '/api/v1/auth/login', { body: { email: 'new.officer@sindh.amanat.test', password: ok.body.temporaryPassword }, ip: '10.8.0.1' });
    expect(login.status).toBe(200);
  });

  it('changes a role (sessions revoked, audited), deactivates (refused at once) and reactivates', async () => {
    const admin = await tok('admin.sana@sindh.amanat.test', 'admin', sindh);
    const imran = t.ids.staffIds['officer.imran@sindh.amanat.test']!;
    const old = await tok('officer.imran@sindh.amanat.test', 'officer', sindh);
    expect((await call(meRoute.GET, '/api/v1/me', { token: old })).status).toBe(200);

    const role = await patch(admin, imran, { role: 'auditor' });
    expect(role.status).toBe(200);
    expect(role.body.from.role).toBe('officer');
    expect(role.body.to.role).toBe('auditor');
    expect((await call(meRoute.GET, '/api/v1/me', { token: old })).status).toBe(401); // the old officer token no longer works
    const ev = await t.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'org.user.update'), eq(auditEvents.resourceId, imran)));
    expect(ev.length).toBe(1);
    expect(JSON.stringify(ev[0]!.details)).toContain('auditor');

    await patch(admin, imran, { role: 'officer' });
    await new Promise((r) => setTimeout(r, 1100)); // a token must be issued after the revoke moment
    const fresh = await tok('officer.imran@sindh.amanat.test', 'officer', sindh);
    expect((await call(meRoute.GET, '/api/v1/me', { token: fresh })).status).toBe(200);

    expect((await patch(admin, imran, { active: false })).status).toBe(200);
    const [m] = await t.db.select({ d: memberships.deactivatedAt }).from(memberships).where(and(eq(memberships.userId, imran), eq(memberships.tenantId, sindh)));
    expect(m!.d).not.toBeNull();
    expect((await call(meRoute.GET, '/api/v1/me', { token: fresh })).status).toBe(401);
    const login = await call(loginRoute.POST, '/api/v1/auth/login', { body: { email: 'officer.imran@sindh.amanat.test', password: TEST_PASSWORD }, ip: '10.8.0.2' });
    expect(login.status).toBe(401);

    expect((await patch(admin, imran, { active: true })).status).toBe(200);
    const again = await call(loginRoute.POST, '/api/v1/auth/login', { body: { email: 'officer.imran@sindh.amanat.test', password: TEST_PASSWORD }, ip: '10.8.0.3' });
    expect(again.status).toBe(200);
  });

  it('guards: not yourself, not the last admin, not another office, not a non-admin', async () => {
    const sana = await tok('admin.sana@sindh.amanat.test', 'admin', sindh);
    const omar = t.ids.staffIds['admin.second.omar@sindh.amanat.test']!;
    expect((await patch(sana, t.ids.staffIds['admin.sana@sindh.amanat.test']!, { active: false })).status).toBe(409);
    expect((await patch(sana, omar, { role: 'officer' })).status).toBe(200); // Sana is still an admin
    const lastAdmin = await patch(await tok('admin.sana@sindh.amanat.test', 'admin', sindh), t.ids.staffIds['admin.sana@sindh.amanat.test']!, { role: 'officer' });
    expect(lastAdmin.status).toBe(409); // also blocked as "yourself"

    const bilal = t.ids.staffIds['officer.bilal@punjab.amanat.test']!;
    expect((await patch(sana, bilal, { active: false })).status).toBe(404); // another office: same answer as an unknown id
    const officer = await tok('senior.officer.hina@sindh.amanat.test', 'officer', sindh);
    expect((await patch(officer, omar, { active: false })).status).toBe(403);
    const ayesha = await tok('admin.ayesha@punjab.amanat.test', 'admin', punjab);
    expect((await patch(ayesha, omar, { role: 'officer' })).status).toBe(404);
    expect((await patch(sana, omar, {})).status).toBe(422);
  });
});
