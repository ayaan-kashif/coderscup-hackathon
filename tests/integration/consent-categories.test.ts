/** CONS-3: a citizen narrows sharing by data category with her PIN; the server enforces each category where the data is used. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { call, fullSeededDb, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { auditEvents, cases, citizens, consents, notifications, users } from '@/db/schema/all';
import { notifyCitizen } from '@/services/notify';
import * as consentsRoute from '../../app/api/v1/me/consents/route';
import * as docsRoute from '../../app/api/v1/cases/[id]/documents/route';
import * as payoutRoute from '../../app/api/v1/payout-changes/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
let sindh: string;
const cit = async (phone: string) => {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
  return { token: await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' }), cid: u!.cid };
};
const grant = (token: string, dataCategories: string[], pin = TEST_PIN) => call(consentsRoute.POST, '/api/v1/me/consents', { token, body: { tenantId: sindh, dataCategories, pin } });
const photo = Buffer.alloc(400, 7).toString('base64');
const anyCase = async (cid: string) => (await t.db.select({ id: cases.id }).from(cases).where(eq(cases.citizenId, cid)).limit(1))[0]!.id;

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; sindh = t.ids.tenantIds['sindh']!; });
afterAll(async () => { await t?.close(); });

describe('CONS-3 consent by data category', () => {
  it('needs her PIN, stores the narrower grant, keeps the old one as history, and audits it', async () => {
    const z = await cit('+920000000001');
    expect((await grant(z.token, ['identity'], '0000')).status).toBe(401);
    expect((await call(consentsRoute.POST, '/api/v1/me/consents', { token: z.token, body: { tenantId: sindh, dataCategories: [], pin: TEST_PIN } })).status).toBe(422);
    const r = await grant(z.token, ['identity', 'documents']);
    expect(r.status).toBe(201);
    expect([...r.body.dataCategories].sort()).toEqual(['case', 'documents', 'identity']);
    const rows = await t.db.select().from(consents).where(and(eq(consents.citizenId, z.cid), eq(consents.tenantId, sindh)));
    expect(rows.filter((x) => x.status === 'active')).toHaveLength(1);
    expect(rows.filter((x) => x.status === 'withdrawn').length).toBeGreaterThanOrEqual(1);
    const ev = await t.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'consent.grant'), eq(auditEvents.subjectCitizenId, z.cid), eq(auditEvents.outcome, 'allowed')));
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(ev[0]!.details)).toContain('identity');
  });

  it('a category she switched off is refused on the server where that data is used', async () => {
    const z = await cit('+920000000002');
    await grant(z.token, ['identity']); // documents, payout, contact and voice are off
    const caseId = await anyCase(z.cid);
    const up = await call(docsRoute.POST, `/api/v1/cases/${caseId}/documents`, { token: z.token, params: { id: caseId }, headers: { 'idempotency-key': 'doc-cat-0001' }, body: { docType: 'cnic_front', dataBase64: photo } });
    expect(up.status).toBe(403);
    expect(up.body.code).toBe('CONSENT_WITHDRAWN');
    expect(up.body.category).toBe('documents');
    const pay = await call(payoutRoute.POST, '/api/v1/payout-changes', { token: z.token, headers: { 'idempotency-key': 'pay-cat-0001' }, body: { walletDigits: '0000000999', pin: TEST_PIN } });
    expect(pay.status).toBe(403);
    expect(pay.body.category).toBe('payments');
    // contact off: in-app only, no SMS or voice note
    const before = (await t.db.select().from(notifications).where(eq(notifications.citizenId, z.cid))).length;
    await notifyCitizen(t.db, { tenantId: sindh, citizenId: z.cid, key: 'in_review' });
    const after = (await t.db.select().from(notifications).where(eq(notifications.citizenId, z.cid))).slice(before);
    expect(after.map((n) => n.channel)).toEqual(['in_app']);
  });

  it('turning categories back on works again; an officer cannot change or read anyone consent', async () => {
    const z = await cit('+920000000002');
    expect((await grant(z.token, ['identity', 'documents', 'payments', 'contact', 'voice'])).status).toBe(201);
    const caseId = await anyCase(z.cid);
    const up = await call(docsRoute.POST, `/api/v1/cases/${caseId}/documents`, { token: z.token, params: { id: caseId }, headers: { 'idempotency-key': 'doc-cat-0002' }, body: { docType: 'cnic_front', dataBase64: photo } });
    expect(up.body.category).toBeUndefined(); // refused for another reason (status or image), not for consent
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: sindh });
    expect((await call(consentsRoute.POST, '/api/v1/me/consents', { token: officer, body: { tenantId: sindh, dataCategories: ['identity'], pin: TEST_PIN } })).status).toBe(403);
    expect((await call(consentsRoute.GET, '/api/v1/me/consents', { token: officer })).status).toBe(403);
  });

  it('one citizen never sees another citizen consent rows', async () => {
    const f = await cit('+920000000002');
    const list = await call(consentsRoute.GET, '/api/v1/me/consents', { token: f.token });
    expect(list.status).toBe(200);
    const ids = new Set(list.body.consents.map((c: { id: string }) => c.id));
    const all = await t.db.select({ id: consents.id, cid: consents.citizenId }).from(consents);
    expect(all.some((x) => x.cid === f.cid)).toBe(true);
    for (const o of all.filter((x) => x.cid !== f.cid)) expect(ids.has(o.id)).toBe(false);
  });
});
