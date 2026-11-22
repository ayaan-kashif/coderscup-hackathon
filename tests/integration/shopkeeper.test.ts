/**
 * The shopkeeper (the brief's second person): username + password sign-up and sign-in, a 403 everywhere else, his own checks only,
 * approved alerts of his own district only, "Report this scam" (counts on the Scam Map), and "Delete my shop account".
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as scamAlertApprove from '../../app/api/v1/scam/alerts/[id]/approve/route';
import * as scamCheck from '../../app/api/v1/scam/check/route';
import * as scamDesk from '../../app/api/v1/scam/desk/route';
import * as scamMap from '../../app/api/v1/scam/map/route';
import * as shopLogin from '../../app/api/v1/auth/shopkeeper/login/route';
import * as shopSignup from '../../app/api/v1/auth/shopkeeper/signup/route';
import * as shopAlerts from '../../app/api/v1/shop/alerts/route';
import * as shopChecks from '../../app/api/v1/shop/checks/route';
import * as shopMe from '../../app/api/v1/shop/me/route';
import * as shopReports from '../../app/api/v1/shop/reports/route';
import { signAccessToken } from '@/auth/tokens';
import { auditEvents, districts, memberships, scamAlerts, scamReports, shopProfiles, users } from '@/db/schema/all';
import { ROUTE_MODULES } from '@/lib/api/openapi';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { aiOff, aiReset } from '../helpers/ai';
import { call, fullSeededDb, TEST_SHOP_PASSWORD } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 180_000 });

type Ids = { staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
let n = 0;
const ip = () => `10.77.${Math.floor(++n / 200)}.${n % 200}`;
const SCAM = { text: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.', sender: '+920000099111' };
const GENUINE = { text: 'SAAYA: Rs 12000 has been sent to your wallet ending 1356 on 2026-02-15. No fee is ever charged. Never share your PIN.', sender: 'SAAYA' };
const goodSignup = (u: string, extra: Record<string, unknown> = {}) => ({ shopName: `Shop ${u}`, username: u, password: 'made-up-pass-1', passwordConfirm: 'made-up-pass-1', districtCode: 'HYD', prototype: true, ...extra });
const signup = (body: Record<string, unknown>, from = ip()) => call(shopSignup.POST, '/api/v1/auth/shopkeeper/signup', { body, ip: from });
const login = (identifier: string, password: string, from = ip()) => call(shopLogin.POST, '/api/v1/auth/shopkeeper/login', { body: { identifier, password }, ip: from });
const check = (token: string, b: Record<string, unknown>) => call(scamCheck.POST, '/api/v1/scam/check', { token, body: { channel: 'text', ...b }, ip: ip() });
let akram = '';

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  resetMemoryRateLimits();
  const r = await login('akram.hyd', TEST_SHOP_PASSWORD);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  akram = r.body.token;
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });
beforeEach(() => resetMemoryRateLimits());

describe('sign-up', () => {
  it('creates exactly one account: user with an argon2id hash, shop profile and a membership in the office of his district, and a session', async () => {
    const r = await signup(goodSignup('bilal_store'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.get('set-cookie')).toMatch(/amanat_session=/i);
    expect(r.body.next).toBe('/shopkeeper');
    const us = await t.db.select().from(users).where(eq(users.username, 'bilal_store'));
    expect(us).toHaveLength(1);
    expect(us[0]!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(us[0]!.passwordHash).not.toContain('made-up-pass-1');
    expect(await t.db.select().from(shopProfiles).where(eq(shopProfiles.userId, us[0]!.id))).toHaveLength(1);
    const ms = await t.db.select().from(memberships).where(eq(memberships.userId, us[0]!.id));
    expect(ms.map((m) => [m.role, m.tenantId])).toEqual([['shopkeeper', t.ids.tenantIds.sindh]]);
    const me = await call(shopMe.GET, '/api/v1/shop/me', { token: r.body.token });
    expect(me.body).toMatchObject({ role: 'shopkeeper', username: 'bilal_store', district: { code: 'HYD' } });
    // the audit event holds ids and the district, not the shop name or username
    const a = JSON.stringify(await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'shop.signup')));
    expect(a).not.toMatch(/bilal_store|Shop bilal/);
  });

  it('a taken username (any case) is refused in both languages and still makes one account; two parallel sign-ups make one', async () => {
    const r = await signup(goodSignup('BILAL_STORE'));
    expect(r.status).toBe(422);
    expect(r.body.fields.username).toEqual({ en: 'That username is taken.', ur: 'یہ یوزر نیم پہلے سے لیا جا چکا ہے۔' });
    const [x, y] = await Promise.all([signup(goodSignup('twin.shop')), signup(goodSignup('twin.shop'))]);
    expect([x.status, y.status].sort()).toEqual([201, 422]);
    expect(await t.db.select().from(users).where(eq(users.username, 'twin.shop'))).toHaveLength(1);
  });

  it('an email that does not end in .test is refused; a made-up .test address is accepted', async () => {
    const bad = await signup(goodSignup('mail_shop', { email: 'owner@gmail.com' }));
    expect(bad.status).toBe(422);
    expect(bad.body.fields.email.en).toMatch(/\.test/);
    expect(bad.body.fields.email.ur).toBeTruthy();
    const ok = await signup(goodSignup('mail_shop', { email: 'Owner@Mail-Shop.test' }));
    expect(ok.status).toBe(201);
    const [u] = await t.db.select({ email: users.email }).from(users).where(eq(users.username, 'mail_shop'));
    expect(u!.email).toBe('owner@mail-shop.test');
  });

  it('per-field messages in English and Urdu for every rule', async () => {
    const r = await signup({ shopName: 'x', username: 'A!', password: 'short', passwordConfirm: 'short', districtCode: 'ZZZ', prototype: false });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.fields).sort()).toEqual(['district', 'password', 'prototype', 'shopName', 'username']);
    for (const m of Object.values(r.body.fields) as { en: string; ur: string }[]) { expect(m.en).toBeTruthy(); expect(m.ur).toBeTruthy(); }
    const mismatch = await signup(goodSignup('mismatch_shop', { passwordConfirm: 'something-else' }));
    expect(mismatch.body.fields.passwordConfirm.en).toMatch(/different/);
    expect(await t.db.select().from(users).where(eq(users.username, 'mismatch_shop'))).toHaveLength(0);
  });

  it('the 4th sign-up in an hour from one IP gets 429', async () => {
    const same = '10.200.0.1';
    for (let i = 0; i < 3; i++) expect((await signup(goodSignup(`rate_${i}_shop`), same)).status).toBe(201);
    const fourth = await signup(goodSignup('rate_3_shop'), same);
    expect(fourth.status).toBe(429);
    expect(await t.db.select().from(users).where(eq(users.username, 'rate_3_shop'))).toHaveLength(0);
  });
});

describe('sign-in', () => {
  it('works with the username or with the email', async () => {
    expect((await login('mail_shop', 'made-up-pass-1')).status).toBe(200);
    const byMail = await login('OWNER@mail-shop.test', 'made-up-pass-1');
    expect(byMail.status).toBe(200);
    expect(byMail.body.role).toBe('shopkeeper');
  });

  it('any wrong detail gives the same 401 and the same message', async () => {
    const a = await login('mail_shop', 'wrong-password');
    const b = await login('nobody_here', 'whatever-1');
    const c = await login('officer.imran@sindh.amanat.test', 'whatever-1'); // staff are not shopkeepers
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.body.en).toBe('Username or password is wrong.');
      expect(r.body.ur).toBe('یوزر نیم یا پاس ورڈ غلط ہے۔');
    }
    expect(a.body.detail).toBe(b.body.detail);
  });

  it('the 6th try in 15 minutes for one username gets 429, even from different IPs', async () => {
    for (let i = 0; i < 5; i++) expect((await login('bilal_store', `wrong-${i}`)).status).toBe(401);
    expect((await login('bilal_store', 'made-up-pass-1')).status).toBe(429);
  });
});

describe('a shopkeeper session is refused everywhere else', () => {
  it('403 on every citizen, helper, officer, admin and auditor API (and every other route not made for him)', async () => {
    const mine = new Set(['scam/check', 'auth/logout', 'shop/me', 'shop/checks', 'shop/alerts', 'shop/reports']);
    const checked: string[] = [];
    for (const mod of Object.values(ROUTE_MODULES)) {
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const h = (mod as Record<string, unknown>)[m] as (((r: Request, c?: unknown) => Promise<Response>) & { spec?: { path: string; auth: string; shopkeeper?: boolean } }) | undefined;
        if (!h?.spec || h.spec.auth === 'public' || h.spec.shopkeeper) continue;
        const rel = h.spec.path.replace('/api/v1/', '');
        if (mine.has(rel)) continue;
        resetMemoryRateLimits();
        const res = await call(h as never, h.spec.path.replace(/\{[a-zA-Z]+\}/g, '00000000-0000-4000-8000-000000000000'), {
          method: m, token: akram, params: { id: '00000000-0000-4000-8000-000000000000', docId: '00000000-0000-4000-8000-000000000000' }, body: m === 'GET' ? undefined : {},
          headers: { 'idempotency-key': crypto.randomUUID() },
        });
        expect(`${m} ${h.spec.path} → ${res.status} ${res.body?.code}`).toBe(`${m} ${h.spec.path} → 403 FORBIDDEN_ROLE`);
        checked.push(`${m} ${rel}`);
      }
    }
    expect(checked.length).toBeGreaterThan(80);
    expect(checked).toEqual(expect.arrayContaining(['GET me', 'GET me/cases', 'GET queue', 'GET scam/desk', 'GET scam/alerts', 'POST cases', 'GET helper/families', 'GET audit/events']));
  });

  it('staff and citizens cannot use the shopkeeper\'s own routes', async () => {
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: t.ids.tenantIds.sindh! });
    for (const [h, p] of [[shopChecks.GET, '/api/v1/shop/checks'], [shopAlerts.GET, '/api/v1/shop/alerts'], [shopMe.GET, '/api/v1/shop/me']] as const) {
      const r = await call(h, p, { token: officer });
      expect(r.status).toBe(403);
    }
  });
});

describe('checking a message', () => {
  it('the demo scam SMS checked for a customer is Fake, with "fee requested" among the reasons and no ledger check', async () => {
    const r = await check(akram, { ...SCAM, sentToMe: false });
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe('fake');
    const contra = r.body.reasons.filter((x: { result: string }) => x.result === 'contradiction').map((x: { code: string }) => x.code);
    expect(contra).toContain('fee');
    expect(r.body.ledger.checked).toBe(false);
    expect(contra).not.toContain('ledger');
  });

  it('sent to him: his ledger is empty, so the claimed payment is "no such payment for you"', async () => {
    const r = await check(akram, { ...SCAM, sentToMe: true });
    expect(r.body.verdict).toBe('fake');
    expect(r.body.ledger).toEqual({ checked: true, matched: false });
    const ledger = r.body.reasons.find((x: { code: string }) => x.code === 'ledger');
    expect(ledger.result).toBe('contradiction');
    expect(ledger.en).toMatch(/no Rs 25,000 payment for you/);
  });

  it('a genuine programme message checked for a customer is never Fake', async () => {
    const r = await check(akram, { ...GENUINE, sentToMe: false });
    expect(r.body.verdict).not.toBe('fake');
    expect(r.body.ledger.checked).toBe(false);
  });

  it('his check is filed under his shop\'s district (Hyderabad), whatever district is sent', async () => {
    const r = await check(akram, { ...SCAM, sentToMe: false, districtCode: 'LHR' });
    const [row] = await t.db.select({ d: districts.code }).from(scamReports).innerJoin(districts, eq(districts.id, scamReports.districtId)).where(eq(scamReports.id, r.body.reportId));
    expect(row!.d).toBe('HYD');
  });

  it('a "not sure" message goes to the Scam desk', async () => {
    const r = await check(akram, { text: 'Hello friend, please call me back about the shop order tomorrow.', sentToMe: false });
    expect(r.body.verdict).toBe('not_sure');
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: t.ids.tenantIds.sindh! });
    const desk = await call(scamDesk.GET, '/api/v1/scam/desk', { token: officer });
    expect(desk.body.items.map((i: { id: string }) => i.id)).toContain(r.body.reportId);
  });
});

describe('Report this scam → the Scam Map → an approved alert in his district', () => {
  it('a fake counts for Hyderabad only after he reports it; the 5th today drafts an alert; once approved he sees it', async () => {
    const hydToday = async () => {
      const m = await call(scamMap.GET, '/api/v1/scam/map', { query: { days: '1', empty: '1' }, ip: ip() });
      return m.body.districts.find((d: { code: string }) => d.code === 'HYD').countToday as number | null;
    };
    // a fresh shopkeeper, so earlier tests do not matter; the seed has 4 Hyderabad fakes today
    await t.db.update(scamReports).set({ reported: false }).where(and(eq(scamReports.verdict, 'fake'), eq(scamReports.reported, true), eq(scamReports.channel, 'text'), eq(scamReports.messageText, SCAM.text)));
    const before = await hydToday();
    const r = await check(akram, { ...SCAM, sentToMe: false });
    expect(r.body.alertDrafted).toBeFalsy();
    expect(await hydToday()).toBe(before); // not counted yet
    const rep = await call(shopReports.POST, '/api/v1/shop/reports', { token: akram, body: { reportId: r.body.reportId } });
    expect(rep.status).toBe(200);
    expect(rep.body.reported).toBe(true);
    expect(await hydToday()).toBe(5);
    expect(rep.body.alertDrafted).toBeTruthy();
    // reporting twice changes nothing
    const again = await call(shopReports.POST, '/api/v1/shop/reports', { token: akram, body: { reportId: r.body.reportId } });
    expect(again.body.already).toBe(true);
    expect(await hydToday()).toBe(5);

    // the draft is not shown to him; the officer approves it; now it is under "Alerts in my district"
    expect((await call(shopAlerts.GET, '/api/v1/shop/alerts', { token: akram })).body.items.map((a: { id: string }) => a.id)).not.toContain(rep.body.alertDrafted);
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: t.ids.tenantIds.sindh! });
    const ap = await call(scamAlertApprove.POST, `/api/v1/scam/alerts/${rep.body.alertDrafted}/approve`, { token: officer, params: { id: rep.body.alertDrafted }, method: 'POST' });
    expect(ap.status).toBe(200);
    const mine = await call(shopAlerts.GET, '/api/v1/shop/alerts', { token: akram });
    expect(mine.body.district.code).toBe('HYD');
    expect(mine.body.items[0].id).toBe(rep.body.alertDrafted);
  });

  it('another shopkeeper cannot report his check (404, like an unknown id), and a non-fake cannot be reported', async () => {
    const r = await check(akram, { ...SCAM, sentToMe: false });
    const other = (await signup(goodSignup('other.shop'))).body.token;
    expect((await call(shopReports.POST, '/api/v1/shop/reports', { token: other, body: { reportId: r.body.reportId } })).status).toBe(404);
    const g = await check(akram, { ...GENUINE, sentToMe: false });
    expect((await call(shopReports.POST, '/api/v1/shop/reports', { token: akram, body: { reportId: g.body.reportId } })).status).toBe(409);
  });
});

describe('his own data only', () => {
  it('My checks lists only his checks, with date, verdict and the reasons in plain words', async () => {
    const lhr = (await signup(goodSignup('lahore.shop', { districtCode: 'LHR' }))).body.token;
    const theirs = await check(lhr, { ...SCAM, sentToMe: false });
    const mine = await call(shopChecks.GET, '/api/v1/shop/checks', { token: akram });
    const ids = mine.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(theirs.body.reportId);
    expect(mine.body.items.length).toBeGreaterThan(3);
    const one = mine.body.items[0];
    expect(one.createdAt).toBeTruthy();
    expect(['fake', 'genuine', 'not_sure']).toContain(one.verdict);
    expect(one.reasons.length).toBeGreaterThan(0);
    expect(one.reasons[0].en).toBeTruthy();
    expect(one.reasons[0].ur).toBeTruthy();
    expect(JSON.stringify(mine.body)).not.toMatch(/messageText|\+92000009/); // no message text or numbers in the list
    const theirList = await call(shopChecks.GET, '/api/v1/shop/checks', { token: lhr });
    expect(theirList.body.items.map((i: { id: string }) => i.id)).toEqual([theirs.body.reportId]);
  });

  it('Alerts shows only approved alerts of his own district: never a draft, never another district', async () => {
    const [hyd] = await t.db.select().from(districts).where(eq(districts.code, 'HYD'));
    const [lhr] = await t.db.select().from(districts).where(eq(districts.code, 'LHR'));
    const [draft] = await t.db.insert(scamAlerts).values({ tenantId: hyd!.tenantId!, districtId: hyd!.id, scamType: 'lottery_prize', count: 9, windowStart: new Date() }).returning();
    const [sent] = await t.db.insert(scamAlerts).values({ tenantId: hyd!.tenantId!, districtId: hyd!.id, scamType: 'lottery_prize', count: 9, windowStart: new Date(), status: 'sent', sentAt: new Date() }).returning();
    const [elsewhere] = await t.db.insert(scamAlerts).values({ tenantId: lhr!.tenantId!, districtId: lhr!.id, scamType: 'lottery_prize', count: 9, windowStart: new Date(), status: 'sent', sentAt: new Date() }).returning();
    const ids = (await call(shopAlerts.GET, '/api/v1/shop/alerts', { token: akram })).body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(sent!.id);
    expect(ids).not.toContain(draft!.id);
    expect(ids).not.toContain(elsewhere!.id);
    const lahoreToken = (await login('lahore.shop', 'made-up-pass-1')).body.token;
    const theirs = (await call(shopAlerts.GET, '/api/v1/shop/alerts', { token: lahoreToken })).body.items.map((a: { id: string }) => a.id);
    expect(theirs).toEqual([elsewhere!.id]);
  });
});

describe('Delete my shop account', () => {
  it('needs his password and the confirmation; removes profile, membership and sessions; his checks stay, unlinked', async () => {
    const s = await signup(goodSignup('closing.shop'));
    const token = s.body.token;
    const c = await check(token, { ...SCAM, sentToMe: false });
    const [u] = await t.db.select({ id: users.id }).from(users).where(eq(users.username, 'closing.shop'));

    expect((await call(shopMe.DELETE, '/api/v1/shop/me', { token, method: 'DELETE', body: { password: 'wrong', confirm: true } })).status).toBe(401);
    expect((await call(shopMe.DELETE, '/api/v1/shop/me', { token, method: 'DELETE', body: { password: 'made-up-pass-1' } })).status).toBe(422);
    const del = await call(shopMe.DELETE, '/api/v1/shop/me', { token, method: 'DELETE', body: { password: 'made-up-pass-1', confirm: true } });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.headers.get('set-cookie')).toMatch(/Max-Age=0/i);

    expect(await t.db.select().from(users).where(eq(users.id, u!.id))).toHaveLength(0);
    expect(await t.db.select().from(shopProfiles).where(eq(shopProfiles.userId, u!.id))).toHaveLength(0);
    expect(await t.db.select().from(memberships).where(eq(memberships.userId, u!.id))).toHaveLength(0);
    const [rep] = await t.db.select({ reporter: scamReports.reporterUserId }).from(scamReports).where(eq(scamReports.id, c.body.reportId));
    expect(rep!.reporter).toBeNull();
    // every session is gone
    expect((await call(shopMe.GET, '/api/v1/shop/me', { token })).status).toBe(401);
    expect((await login('closing.shop', 'made-up-pass-1')).status).toBe(401);
    expect(await t.db.select().from(auditEvents).where(eq(auditEvents.action, 'shop.delete'))).toHaveLength(1);
  });
});
