/**
 * Silent Duress PIN (coercion-safe mode). The reversed PIN must look exactly like the real one to whoever is
 * holding the phone, while the server shadow-freezes the case, holds the payout change, quarantines the helper's
 * unlock, raises a CRITICAL Scam Desk alarm, queues a discreet SMS and keeps the audit chain intact.
 */
import { and, desc, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as auditVerify from '../../app/api/v1/audit/verify/route';
import * as cases from '../../app/api/v1/cases/route';
import * as caseStatus from '../../app/api/v1/cases/[id]/status/route';
import * as families from '../../app/api/v1/helper/families/route';
import * as grants from '../../app/api/v1/helper/grants/route';
import * as helperActivity from '../../app/api/v1/helper/activity/route';
import * as accessLog from '../../app/api/v1/me/access-log/route';
import * as meCases from '../../app/api/v1/me/cases/route';
import * as payoutApprove from '../../app/api/v1/payout-changes/[id]/approve/route';
import * as payoutChanges from '../../app/api/v1/payout-changes/route';
import * as pinSet from '../../app/api/v1/auth/pin/set/route';
import * as pinVerify from '../../app/api/v1/auth/pin/verify/route';
import * as duressList from '../../app/api/v1/scam/duress/route';
import * as duressResolve from '../../app/api/v1/scam/duress/[id]/resolve/route';
import { verifySecret } from '@/auth/crypto';
import { signAccessToken } from '@/auth/tokens';
import { auditEvents, cases as casesT, citizens, duressAlarms, helperGrants, mockSmsMessages, payoutChanges as payoutChangesT, users } from '@/db/schema/all';
import { flushDeferred } from '@/lib/defer';
import { reversePin } from '@/services/duress';
import { seededCaseIds } from '@/services/seed/demo-cases';
import { aiOff, aiReset } from '../helpers/ai';
import { call, fullSeededDb, idem, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 120_000 });

type Ids = { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
const DURESS_PIN = reversePin(TEST_PIN); // 2580 → 0852
const tok: Record<string, string> = {};

async function citizen(phone: string, stage: 'otp' | 'full' = 'full') {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
  return { userId: u!.id, citizenId: u!.cid, token: await signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage }) };
}
const staff = (email: string, role: 'officer' | 'auditor' | 'helper', tenant: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]! });
const keys = (o: object) => Object.keys(o).sort();
// the normal receipt has a `frozenCases` count key, so only values are checked for the words
const noLeak = (text: string) => expect(text.replace(/"frozenCases"/g, '').toLowerCase()).not.toMatch(/duress|frozen|alarm|coerc|suspicious/);

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  tok.imran = await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh');
  tok.raza = await staff('auditor.raza@sindh.amanat.test', 'auditor', 'sindh');
  tok.shabana = await staff('helper.shabana@sindh.amanat.test', 'helper', 'sindh');
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });

describe('PIN set: palindromes are refused so the reversed PIN is always distinct', () => {
  it('rejects 1221 / 4554 with a bilingual message and stores the duress hash for a good PIN', async () => {
    const z = await citizen('+920000000003', 'otp');
    await t.db.update(citizens).set({ pinHash: null, duressPinHash: null }).where(eq(citizens.id, z.citizenId));
    for (const pin of ['1221', '4554', '0000']) {
      const r = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: z.token, body: { pin } });
      expect(r.status, pin).toBe(422);
      expect(r.body.code).toBe('VALIDATION_FAILED');
    }
    const r = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: z.token, body: { pin: '1221' } });
    expect(r.body.reason).toBe('palindrome');
    expect(r.body.en).toMatch(/backwards/);
    expect(r.body.ur).toMatch(/الٹا/);
    const ok = await call(pinSet.POST, '/api/v1/auth/pin/set', { token: z.token, body: { pin: '4729' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [row] = await t.db.select({ pin: citizens.pinHash, duress: citizens.duressPinHash }).from(citizens).where(eq(citizens.id, z.citizenId));
    expect(await verifySecret(row!.duress!, '9274')).toBe(true);
    expect(await verifySecret(row!.pin!, '9274')).toBe(false);
  });
});

describe('the real PIN: zero regression', () => {
  it('signs in normally and raises no alarm', async () => {
    const z = await citizen('+920000000001', 'otp');
    const before = await t.db.select({ id: duressAlarms.id }).from(duressAlarms);
    const r = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: z.token, body: { pin: TEST_PIN } });
    expect(r.status).toBe(200);
    expect(keys(r.body)).toEqual(['expiresIn', 'stage', 'token', 'tokenType']);
    expect(await t.db.select({ id: duressAlarms.id }).from(duressAlarms)).toHaveLength(before.length);
  });

  it('a wrong PIN is still refused and counted', async () => {
    const z = await citizen('+920000000001', 'otp');
    const r = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: z.token, body: { pin: '1357' } });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('PIN_INVALID');
  });
});

describe('reversed PIN on a payout-number change (Fatima, seeded case)', () => {
  let fatima: Awaited<ReturnType<typeof citizen>>;
  let fatimaCase = '';
  let resp: Awaited<ReturnType<typeof call>>;

  beforeAll(async () => {
    fatima = await citizen('+920000000002');
    fatimaCase = (await seededCaseIds(t.db))['seed-fatima-s1']!;
    resp = await call(payoutChanges.POST, '/api/v1/payout-changes', { token: fatima.token, headers: { ...idem(), 'user-agent': 'CoercerPhone/1.0' }, ip: '10.9.9.9', body: { walletDigits: '0000007788', pin: DURESS_PIN } });
    await flushDeferred();
  });

  it('answers 201 with the normal receipt shape and nothing that hints at an alarm', async () => {
    expect(resp.status, JSON.stringify(resp.body)).toBe(201);
    expect(keys(resp.body)).toEqual(['frozenCases', 'id', 'newLast4', 'status']);
    expect(resp.body.status).toBe('pending_officer');
    expect(resp.body.newLast4).toBe('7788');
    expect(resp.body.frozenCases).toBe(0);
    noLeak(resp.text);
  });

  it('holds the payout change so it can never be approved', async () => {
    const [ch] = await t.db.select().from(payoutChangesT).where(eq(payoutChangesT.id, resp.body.id));
    expect(ch!.status).toBe('duress_hold');
    const approve = await call(payoutApprove.POST, `/api/v1/payout-changes/${resp.body.id}/approve`, { token: tok.imran, method: 'POST', params: { id: resp.body.id }, headers: idem() });
    expect(approve.status).toBe(409);
  });

  it('shadow-freezes the case, but the citizen still sees an ordinary review', async () => {
    const [k] = await t.db.select({ status: casesT.status, reason: casesT.frozenReason }).from(casesT).where(eq(casesT.id, fatimaCase));
    expect(k!.status).toBe('frozen');
    expect(k!.reason).toMatch(/^DURESS_SILENT_ALARM/);
    const s = await call(caseStatus.GET, `/api/v1/cases/${fatimaCase}/status`, { token: fatima.token, params: { id: fatimaCase } });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('in_review');
    noLeak(s.text);
    const list = await call(meCases.GET, '/api/v1/me/cases', { token: fatima.token });
    expect(list.body.items.find((x: { id: string }) => x.id === fatimaCase).status).toBe('in_review');
    const log = await call(accessLog.GET, '/api/v1/me/access-log', { token: fatima.token });
    noLeak(log.text);
  });

  it('raises a CRITICAL DURESS_SILENT_ALARM with the attempted wallet and session evidence', async () => {
    const [a] = await t.db.select().from(duressAlarms).where(and(eq(duressAlarms.citizenId, fatima.citizenId), eq(duressAlarms.trigger, 'payout_change')));
    expect(a).toBeTruthy();
    expect(a!.type).toBe('DURESS_SILENT_ALARM');
    expect(a!.severity).toBe('CRITICAL');
    expect(a!.status).toBe('open');
    expect(a!.caseId).toBe(fatimaCase);
    expect(a!.payoutChangeId).toBe(resp.body.id);
    expect((a!.attempted as { newLast4: string }).newLast4).toBe('7788');
    expect(a!.session).toMatchObject({ ip: '10.9.9.9', userAgent: 'CoercerPhone/1.0', actorId: fatima.userId });
  });

  it('writes DURESS_PIN_TRIGGERED to the audit chain under a system actor, and the chain verifies', async () => {
    const [e] = await t.db.select().from(auditEvents).where(and(eq(auditEvents.action, 'DURESS_PIN_TRIGGERED'), eq(auditEvents.subjectCitizenId, fatima.citizenId))).orderBy(desc(auditEvents.id)).limit(1);
    expect(e).toBeTruthy();
    expect(e!.actorType).toBe('system');
    expect(e!.actorId).toBe('duress.silent_alarm');
    const d = e!.details as Record<string, unknown>;
    expect(d.blockedPayoutChangeIds).toEqual([resp.body.id]);
    expect(JSON.stringify(d)).not.toContain('10.9.9.9'); // ids and hashes only
    const v = await call(auditVerify.POST, '/api/v1/audit/verify', { token: tok.raza, body: {} });
    expect(v.status).toBe(200);
    expect(v.body.intact).toBe(true);
  });

  it('queues a discreet bilingual safety SMS to her own phone', async () => {
    const msgs = await t.db.select().from(mockSmsMessages).where(and(eq(mockSmsMessages.toPhone, '+920000000002'), like(mockSmsMessages.body, '%Your relief account is protected%')));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toMatch(/سایہ ریلیف/);
    noLeak(msgs[0]!.body);
  });

  it('the officer sees it on the Scam Desk and can confirm a permanent block', async () => {
    const l = await call(duressList.GET, '/api/v1/scam/duress', { token: tok.imran });
    expect(l.status).toBe(200);
    const item = l.body.items.find((x: { payoutChangeId: string }) => x.payoutChangeId === resp.body.id);
    expect(item).toMatchObject({ type: 'DURESS_SILENT_ALARM', severity: 'CRITICAL', status: 'open', attempted: { newLast4: '7788' } });
    const r = await call(duressResolve.POST, `/api/v1/scam/duress/${item.id}/resolve`, { token: tok.imran, params: { id: item.id }, body: { action: 'confirm_block', note: 'Called her alone: she was forced.' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [ch] = await t.db.select({ status: payoutChangesT.status }).from(payoutChangesT).where(eq(payoutChangesT.id, resp.body.id));
    expect(ch!.status).toBe('rejected');
  });

  it('a citizen cannot read the duress alarms', async () => {
    const r = await call(duressList.GET, '/api/v1/scam/duress', { token: fatima.token });
    expect(r.status).toBe(403);
  });
});

describe('reversed PIN on a helper phone (family unlock)', () => {
  let famA = '';
  let caseA = '';
  let unlock: Awaited<ReturnType<typeof call>>;
  let normal: Awaited<ReturnType<typeof call>>;

  beforeAll(async () => {
    const f = await call(families.GET, '/api/v1/helper/families', { token: tok.shabana });
    const withDraft = f.body.families.filter((x: { case: { status: string } | null }) => x.case?.status === 'draft');
    famA = withDraft[0].citizenId; caseA = withDraft[0].case.id;
    // a legacy family (seeded without a duress hash): the real PIN unlocks normally and backfills the duress hash
    normal = await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, body: { citizenId: famA, pin: TEST_PIN } });
    unlock = await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, headers: { 'user-agent': 'HelperPhone/2.0' }, body: { citizenId: famA, pin: DURESS_PIN, deviceId: 'helper-device-7' } });
    await flushDeferred();
  });

  it('a legacy account gets its duress hash on the next real PIN', async () => {
    expect(normal.status).toBe(201);
    const [c] = await t.db.select({ d: citizens.duressPinHash }).from(citizens).where(eq(citizens.id, famA));
    expect(c!.d).toBeTruthy();
  });

  it('the helper sees an ordinary unlock (same 201 shape)', async () => {
    expect(unlock.status, JSON.stringify(unlock.body)).toBe(201);
    expect(keys(unlock.body)).toEqual(keys(normal.body));
    noLeak(unlock.text);
  });

  it('every unlock for that family is quarantined and the case is shadow-frozen', async () => {
    const live = await t.db.select({ id: helperGrants.id }).from(helperGrants).where(and(eq(helperGrants.citizenId, famA)));
    const rows = await t.db.select({ revokedAt: helperGrants.revokedAt }).from(helperGrants).where(eq(helperGrants.citizenId, famA));
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    const [k] = await t.db.select({ status: casesT.status }).from(casesT).where(eq(casesT.id, caseA));
    expect(k!.status).toBe('frozen');
  });

  it('the helper\'s own views do not reveal it', async () => {
    const f = await call(families.GET, '/api/v1/helper/families', { token: tok.shabana });
    const fam = f.body.families.find((x: { citizenId: string }) => x.citizenId === famA);
    expect(fam.case.status).toBe('in_review');
    expect(fam.case.flagged).toBe(false);
    const act = await call(helperActivity.GET, '/api/v1/helper/activity', { token: tok.shabana });
    noLeak(act.text);
  });

  it('the alarm names the helper, the quarantined unlocks and the device', async () => {
    const [a] = await t.db.select().from(duressAlarms).where(and(eq(duressAlarms.citizenId, famA), eq(duressAlarms.trigger, 'helper_unlock')));
    expect(a!.helperUserId).toBe(t.ids.staffIds['helper.shabana@sindh.amanat.test']);
    expect(a!.helperGrantIds.length).toBeGreaterThanOrEqual(2);
    expect(a!.session).toMatchObject({ userAgent: 'HelperPhone/2.0', deviceId: 'helper-device-7', actorRole: 'helper' });
  });

  it('Mark Safe after a voice check returns the case to an officer\'s review', async () => {
    const [a] = await t.db.select({ id: duressAlarms.id }).from(duressAlarms).where(and(eq(duressAlarms.citizenId, famA), eq(duressAlarms.trigger, 'helper_unlock')));
    const r = await call(duressResolve.POST, `/api/v1/scam/duress/${a!.id}/resolve`, { token: tok.imran, params: { id: a!.id }, body: { action: 'mark_safe', note: 'Voice check: she is safe.' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [k] = await t.db.select({ status: casesT.status, reason: casesT.frozenReason }).from(casesT).where(eq(casesT.id, caseA));
    expect(k!.status).toBe('in_review');
    expect(k!.reason).toBeNull();
    const again = await call(duressResolve.POST, `/api/v1/scam/duress/${a!.id}/resolve`, { token: tok.imran, params: { id: a!.id }, body: { action: 'mark_safe', note: 'twice' } });
    expect(again.status).toBe(409);
  });
});

describe('reversed PIN at sign-in', () => {
  it('signs in exactly like the real PIN while raising the alarm', async () => {
    const z = await citizen('+920000000001');
    const draft = await call(cases.POST, '/api/v1/cases', { token: z.token, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'duress-zarina-0001' } });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const otp = await citizen('+920000000001', 'otp');
    const r = await call(pinVerify.POST, '/api/v1/auth/pin/verify', { token: otp.token, body: { pin: DURESS_PIN } });
    expect(r.status).toBe(200);
    expect(keys(r.body)).toEqual(['expiresIn', 'stage', 'token', 'tokenType']);
    expect(r.body.stage).toBe('full');
    noLeak(r.text);
    const [a] = await t.db.select().from(duressAlarms).where(and(eq(duressAlarms.citizenId, z.citizenId), eq(duressAlarms.trigger, 'pin_verify')));
    expect(a!.caseId).toBe(draft.body.id);
    const v = await call(auditVerify.POST, '/api/v1/audit/verify', { token: tok.raza, body: {} });
    expect(v.body.intact).toBe(true);
  });
});
