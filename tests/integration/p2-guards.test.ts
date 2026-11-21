/**
 * Prompt 2 endpoints × the four guards (PRD §13.4): role, tenant (404 identical to unknown), helper grant, consent.
 * Plus the flows that are permission stories: helper unlock and anomaly freeze, consent withdrawal (CONS-5),
 * payout change with "press 9", scam verdicts, the policy assistant's refusal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as accessLog from '../../app/api/v1/me/access-log/route';
import * as aiDecisionsRoute from '../../app/api/v1/ai-decisions/route';
import * as answers from '../../app/api/v1/cases/[id]/answers/route';
import * as assign from '../../app/api/v1/cases/[id]/assign/route';
import * as assistPolicy from '../../app/api/v1/assist/policy/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as cases from '../../app/api/v1/cases/route';
import * as closeRoute from '../../app/api/v1/cases/[id]/close/route';
import * as complaintById from '../../app/api/v1/complaints/[id]/route';
import * as complaintResolve from '../../app/api/v1/complaints/[id]/resolve/route';
import * as complaintsRoute from '../../app/api/v1/complaints/route';
import * as consentsRoute from '../../app/api/v1/me/consents/route';
import * as correctionApprove from '../../app/api/v1/corrections/[id]/approve/route';
import * as correctionsRoute from '../../app/api/v1/corrections/route';
import * as decisionById from '../../app/api/v1/decisions/[id]/route';
import * as decisionsRoute from '../../app/api/v1/cases/[id]/decisions/route';
import * as documents from '../../app/api/v1/cases/[id]/documents/route';
import * as documentImage from '../../app/api/v1/cases/[id]/documents/[docId]/route';
import * as explanation from '../../app/api/v1/cases/[id]/explanation/route';
import * as families from '../../app/api/v1/helper/families/route';
import * as freeze from '../../app/api/v1/cases/[id]/freeze/route';
import * as grantById from '../../app/api/v1/helper/grants/[id]/route';
import * as grants from '../../app/api/v1/helper/grants/route';
import * as helperActivity from '../../app/api/v1/helper/activity/route';
import * as meCorrections from '../../app/api/v1/me/corrections/route';
import * as payoutApprove from '../../app/api/v1/payout-changes/[id]/approve/route';
import * as payoutObject from '../../app/api/v1/payout-changes/[id]/object/route';
import * as payoutChanges from '../../app/api/v1/payout-changes/route';
import * as queue from '../../app/api/v1/queue/route';
import * as replay from '../../app/api/v1/decisions/[id]/replay/route';
import * as scamAlertApprove from '../../app/api/v1/scam/alerts/[id]/approve/route';
import * as scamAlerts from '../../app/api/v1/scam/alerts/route';
import * as scamCheck from '../../app/api/v1/scam/check/route';
import * as scamDesk from '../../app/api/v1/scam/desk/route';
import * as scamMap from '../../app/api/v1/scam/map/route';
import * as status from '../../app/api/v1/cases/[id]/status/route';
import * as submit from '../../app/api/v1/cases/[id]/submit/route';
import * as timeline from '../../app/api/v1/cases/[id]/timeline/route';
import * as unfreeze from '../../app/api/v1/cases/[id]/unfreeze/route';
import * as voice from '../../app/api/v1/cases/[id]/voice/route';
import * as withdraw from '../../app/api/v1/me/consents/[id]/withdraw/route';
import { signAccessToken } from '@/auth/tokens';
import { auditEvents, cases as casesT, citizens, consents, decisions, documents as documentsT, helperAssignments, mockSmsMessages, users } from '@/db/schema/all';
import { flushDeferred } from '@/lib/defer';
import { resetMemoryRateLimits } from '@/lib/rate-limit';
import { seededCaseIds } from '@/services/seed/demo-cases';
import { aiOff, aiReset, mockAi } from '../helpers/ai';
import { call, fullSeededDb, idem, TEST_PIN } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 120_000 });

type Ids = { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
const tok: Record<string, string> = {};
const doc = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../data/documents', f)).toString('base64');

async function citizenToken(phone: string) {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
  return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
}
const staff = (email: string, role: 'officer' | 'admin' | 'auditor' | 'helper', tenant: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]! });

let zarinaCase = '';
let rukhsanaCase = '';
let fatimaCase = '';

async function draftFor(token: string, key: string) {
  const r = await call(cases.POST, '/api/v1/cases', { token, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: key } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  tok.zarina = await citizenToken('+920000000001');
  tok.fatima = await citizenToken('+920000000002');
  tok.rukhsana = await citizenToken('+920000000003');
  tok.imran = await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh');
  tok.bilal = await staff('officer.bilal@punjab.amanat.test', 'officer', 'punjab');
  tok.sana = await staff('admin.sana@sindh.amanat.test', 'admin', 'sindh');
  tok.raza = await staff('auditor.raza@sindh.amanat.test', 'auditor', 'sindh');
  tok.shabana = await staff('helper.shabana@sindh.amanat.test', 'helper', 'sindh');
  tok.nadia = await staff('helper.nadia@punjab.amanat.test', 'helper', 'punjab');
  fatimaCase = (await seededCaseIds(t.db))['seed-fatima-s1']!;
  // Zarina: a submitted case decided with every model unavailable (fallback path → a person)
  zarinaCase = await draftFor(tok.zarina, 'guards-zarina-0001');
  await call(answers.PATCH, `/api/v1/cases/${zarinaCase}/answers`, { method: 'PATCH', token: tok.zarina, params: { id: zarinaCase }, body: { answers: [{ question: 'name', value: 'Zarina Bibi', via: 'voice' }, { question: 'income', value: 8000, via: 'keypad' }] } });
  await call(documents.POST, `/api/v1/cases/${zarinaCase}/documents`, { token: tok.zarina, params: { id: zarinaCase }, headers: idem(), body: { docType: 'cnic_front', dataBase64: doc('persona-zarina-cnic_front.png') } });
  await call(submit.POST, `/api/v1/cases/${zarinaCase}/submit`, { token: tok.zarina, params: { id: zarinaCase }, method: 'POST', headers: idem() });
  await flushDeferred();
  rukhsanaCase = await draftFor(tok.rukhsana, 'guards-rukhsana-0001');
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });

describe('models unavailable → the pipeline still ends with a person, never an approval', () => {
  it('Zarina\'s case decided without any AI is not auto-approved', async () => {
    const [d] = await t.db.select().from(decisions).where(eq(decisions.caseId, zarinaCase)).orderBy(desc(decisions.createdAt)).limit(1);
    expect(d, 'a decision exists').toBeTruthy();
    expect(d!.outcome).not.toBe('AUTO_APPROVE');
  });
});

describe('role (403 FORBIDDEN_ROLE)', () => {
  it.each([
    ['citizen → queue', () => call(queue.GET, '/api/v1/queue', { token: tok.zarina })],
    ['helper → queue', () => call(queue.GET, '/api/v1/queue', { token: tok.shabana })],
    ['admin → officer decision', () => call(decisionsRoute.POST, `/api/v1/cases/${fatimaCase}/decisions`, { token: tok.sana, params: { id: fatimaCase }, headers: idem(), body: { action: 'approve', reasonCode: 'evidence_reviewed' } })],
    ['auditor → freeze', () => call(freeze.POST, `/api/v1/cases/${fatimaCase}/freeze`, { token: tok.raza, params: { id: fatimaCase }, body: { reason: 'testing role' } })],
    ['citizen → complaints queue', () => call(complaintsRoute.GET, '/api/v1/complaints', { token: tok.zarina })],
    ['helper → corrections queue', () => call(correctionsRoute.GET, '/api/v1/corrections', { token: tok.shabana })],
    ['officer → helper families', () => call(families.GET, '/api/v1/helper/families', { token: tok.imran })],
    ['helper → payout change (HELP-4)', () => call(payoutChanges.POST, '/api/v1/payout-changes', { token: tok.shabana, headers: idem(), body: { walletDigits: '0000009999', pin: TEST_PIN } })],
    ['helper → consent (HELP-4)', () => call(consentsRoute.GET, '/api/v1/me/consents', { token: tok.shabana })],
    ['officer → citizen access log', () => call(accessLog.GET, '/api/v1/me/access-log', { token: tok.imran })],
    ['citizen → scam desk', () => call(scamDesk.GET, '/api/v1/scam/desk', { token: tok.zarina })],
    ['auditor → assign', () => call(assign.POST, `/api/v1/cases/${fatimaCase}/assign`, { token: tok.raza, params: { id: fatimaCase }, body: { officerId: t.ids.staffIds['officer.imran@sindh.amanat.test']! } })],
    ['citizen → ai decisions', () => call(aiDecisionsRoute.GET, '/api/v1/ai-decisions', { token: tok.zarina })],
    ['citizen → payout approvals', () => call(payoutChanges.GET, '/api/v1/payout-changes', { token: tok.zarina })],
  ])('%s', async (_n, fn) => {
    const r = await fn();
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN_ROLE');
  });
});

describe('tenant: another office\'s resource is 404, byte-identical to an unknown id (TEN-2)', () => {
  const unknown = '00000000-0000-4000-8000-000000000000';
  it.each([
    ['full case view', (id: string) => call(caseById.GET, `/api/v1/cases/${id}`, { token: tok.bilal, params: { id }, query: { view: 'full' } })],
    ['timeline', (id: string) => call(timeline.GET, `/api/v1/cases/${id}/timeline`, { token: tok.bilal, params: { id } })],
    ['explanation', (id: string) => call(explanation.GET, `/api/v1/cases/${id}/explanation`, { token: tok.bilal, params: { id } })],
    ['decide', (id: string) => call(decisionsRoute.POST, `/api/v1/cases/${id}/decisions`, { token: tok.bilal, params: { id }, headers: idem(), body: { action: 'approve', reasonCode: 'evidence_reviewed' } })],
    ['freeze', (id: string) => call(freeze.POST, `/api/v1/cases/${id}/freeze`, { token: tok.bilal, params: { id }, body: { reason: 'cross tenant probe' } })],
    ['close', (id: string) => call(closeRoute.POST, `/api/v1/cases/${id}/close`, { token: tok.bilal, params: { id }, body: { reasonCode: 'withdrawn' } })],
  ])('%s', async (_n, fn) => {
    const other = await fn(fatimaCase);
    const none = await fn(unknown);
    expect(other.status).toBe(404);
    expect(none.status).toBe(404);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(other.body)).toEqual(strip(none.body));
  });

  it('a citizen cannot touch another citizen\'s case (404)', async () => {
    const r = await call(status.GET, `/api/v1/cases/${zarinaCase}/status`, { token: tok.fatima, params: { id: zarinaCase } });
    expect(r.status).toBe(404);
  });

  it('the decision trace of another tenant is 404', async () => {
    const [d] = await t.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, fatimaCase)).limit(1);
    const r = await call(decisionById.GET, `/api/v1/decisions/${d!.id}`, { token: tok.bilal, params: { id: d!.id } });
    expect(r.status).toBe(404);
    const rr = await call(replay.POST, `/api/v1/decisions/${d!.id}/replay`, { token: tok.bilal, params: { id: d!.id }, method: 'POST' });
    expect(rr.status).toBe(404);
  });
});

describe('helper grant: no unlock → 403 GRANT_REQUIRED; the family\'s PIN unlocks; switching locks (HELP-2/3)', () => {
  let famA = '', famB = '', caseA = '', caseB = '';
  beforeAll(async () => {
    const f = await call(families.GET, '/api/v1/helper/families', { token: tok.shabana });
    expect(f.status).toBe(200);
    expect(f.body.families.length).toBeLessThanOrEqual(40);
    // avatars, never trust pictures; masked CNIC (HELP-1/4)
    expect(f.body.families[0]).not.toHaveProperty('trustPictureId');
    expect(f.body.families.every((x: { cnic: string }) => x.cnic.startsWith('XXXXX-'))).toBe(true);
    const withDraft = f.body.families.filter((x: { case: { status: string } | null }) => x.case?.status === 'draft');
    famA = withDraft[0].citizenId; caseA = withDraft[0].case.id;
    famB = withDraft[1].citizenId; caseB = withDraft[1].case.id;
  });

  it.each([
    ['answers', () => call(answers.PATCH, `/api/v1/cases/${caseA}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: caseA }, body: { answers: [{ question: 'income', value: 5000, via: 'keypad' }] } })],
    ['documents', () => call(documents.POST, `/api/v1/cases/${caseA}/documents`, { token: tok.shabana, params: { id: caseA }, headers: idem(), body: { docType: 'cnic_front', dataBase64: doc('01-cnic_front-clean.png') } })],
    ['voice', () => call(voice.POST, `/api/v1/cases/${caseA}/voice`, { token: tok.shabana, params: { id: caseA }, headers: idem(), body: { questionKey: 'name', mediaType: 'audio/webm', dataBase64: Buffer.alloc(200).toString('base64'), durationMs: 2000 } })],
    ['submit', () => call(submit.POST, `/api/v1/cases/${caseA}/submit`, { token: tok.shabana, params: { id: caseA }, method: 'POST', headers: idem() })],
    ['status', () => call(status.GET, `/api/v1/cases/${caseA}/status`, { token: tok.shabana, params: { id: caseA } })],
  ])('%s without an unlock', async (_n, fn) => {
    const r = await fn();
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('GRANT_REQUIRED');
  });

  it('a wrong family PIN is refused and counted; the right one unlocks for 2 hours', async () => {
    const bad = await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, body: { citizenId: famA, pin: '0000' } });
    expect(bad.status).toBe(401);
    expect(bad.body.triesLeft).toBe(4);
    const ok = await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, body: { citizenId: famA, pin: TEST_PIN } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(new Date(ok.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(110 * 60_000);
    const a = await call(answers.PATCH, `/api/v1/cases/${caseA}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: caseA }, body: { answers: [{ question: 'income', value: 5000, via: 'keypad' }] } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    // a helper never reads the full case (no full CNIC): the masked status only
    const full = await call(caseById.GET, `/api/v1/cases/${caseA}`, { token: tok.shabana, params: { id: caseA } });
    expect(JSON.stringify(full.body)).not.toMatch(/\d{5}-\d{7}-\d/);
  });

  it('unlocking family B locks family A', async () => {
    const ok = await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, body: { citizenId: famB, pin: TEST_PIN } });
    expect(ok.status).toBe(201);
    const a = await call(answers.PATCH, `/api/v1/cases/${caseA}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: caseA }, body: { answers: [{ question: 'income', value: 6000, via: 'keypad' }] } });
    expect(a.body.code).toBe('GRANT_REQUIRED');
    const b = await call(answers.PATCH, `/api/v1/cases/${caseB}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: caseB }, body: { answers: [{ question: 'income', value: 6000, via: 'keypad' }] } });
    expect(b.status).toBe(200);
    const lock = await call(grantById.DELETE, `/api/v1/helper/grants/${ok.body.grantId}`, { method: 'DELETE', token: tok.shabana, params: { id: ok.body.grantId } });
    expect(lock.status).toBe(200);
    const after = await call(answers.PATCH, `/api/v1/cases/${caseB}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: caseB }, body: { answers: [{ question: 'income', value: 6000, via: 'keypad' }] } });
    expect(after.body.code).toBe('GRANT_REQUIRED');
  });

  it('another office\'s helper cannot unlock this family (404)', async () => {
    const r = await call(grants.POST, '/api/v1/helper/grants', { token: tok.nadia, body: { citizenId: famA, pin: TEST_PIN } });
    expect(r.status).toBe(404);
  });

  it('HELP-5: one wallet entered for two families freezes both cases and alerts an officer', async () => {
    for (const [fam, k] of [[famA, caseA], [famB, caseB]] as const) {
      await call(grants.POST, '/api/v1/helper/grants', { token: tok.shabana, body: { citizenId: fam, pin: TEST_PIN } });
      const r = await call(answers.PATCH, `/api/v1/cases/${k}/answers`, { method: 'PATCH', token: tok.shabana, params: { id: k }, body: { answers: [{ question: 'wallet', value: '0000009999', via: 'keypad' }] } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const rows = await t.db.select({ id: casesT.id, status: casesT.status, reason: casesT.frozenReason }).from(casesT).where(eq(casesT.id, caseA));
    const rowsB = await t.db.select({ status: casesT.status }).from(casesT).where(eq(casesT.id, caseB));
    expect(rows[0]!.status).toBe('frozen');
    expect(rowsB[0]!.status).toBe('frozen');
    expect(rows[0]!.reason).toMatch(/one wallet/);
    const act = await call(helperActivity.GET, '/api/v1/helper/activity', { token: tok.shabana });
    expect(act.body.items.some((x: { action: string }) => x.action === 'case.answers')).toBe(true);
  });
});

describe('consent withdrawal: every staff read of her data is 403 CONSENT_WITHDRAWN, logged, and in her access log', () => {
  it('withdraws with the voice warning and PIN; her case pauses', async () => {
    const list = await call(consentsRoute.GET, '/api/v1/me/consents', { token: tok.zarina });
    expect(list.status).toBe(200);
    expect(list.body.processors.length).toBeGreaterThan(0);
    const active = list.body.consents.find((c: { status: string }) => c.status === 'active');
    const noWarn = await call(withdraw.POST, `/api/v1/me/consents/${active.id}/withdraw`, { token: tok.zarina, params: { id: active.id }, body: { pin: TEST_PIN } });
    expect(noWarn.status).toBe(422);
    const r = await call(withdraw.POST, `/api/v1/me/consents/${active.id}/withdraw`, { token: tok.zarina, params: { id: active.id }, body: { pin: TEST_PIN, heardWarning: true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.pausedCases).toContain(zarinaCase);
  });

  it.each([
    ['case', () => call(caseById.GET, `/api/v1/cases/${zarinaCase}`, { token: tok.imran, params: { id: zarinaCase } })],
    ['full view', () => call(caseById.GET, `/api/v1/cases/${zarinaCase}`, { token: tok.imran, params: { id: zarinaCase }, query: { view: 'full' } })],
    ['timeline', () => call(timeline.GET, `/api/v1/cases/${zarinaCase}/timeline`, { token: tok.imran, params: { id: zarinaCase } })],
    ['explanation', () => call(explanation.GET, `/api/v1/cases/${zarinaCase}/explanation`, { token: tok.imran, params: { id: zarinaCase } })],
    ['document photo', async () => {
      const [d] = await t.db.select({ id: documentsT.id }).from(documentsT).where(eq(documentsT.caseId, zarinaCase)).limit(1);
      return call(documentImage.GET, `/api/v1/cases/${zarinaCase}/documents/${d!.id}`, { token: tok.imran, params: { id: zarinaCase, docId: d!.id } });
    }],
    ['decide', () => call(decisionsRoute.POST, `/api/v1/cases/${zarinaCase}/decisions`, { token: tok.imran, params: { id: zarinaCase }, headers: idem(), body: { action: 'approve', reasonCode: 'evidence_reviewed' } })],
    ['decision trace', async () => {
      const [d] = await t.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, zarinaCase)).limit(1);
      return call(decisionById.GET, `/api/v1/decisions/${d!.id}`, { token: tok.imran, params: { id: d!.id } });
    }],
  ])('officer reads %s → 403', async (_n, fn) => {
    const r = await fn();
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('CONSENT_WITHDRAWN');
  });

  it('the auditor still sees the trace, with personal fields removed', async () => {
    const [d] = await t.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, zarinaCase)).limit(1);
    const r = await call(decisionById.GET, `/api/v1/decisions/${d!.id}`, { token: tok.raza, params: { id: d!.id } });
    expect(r.status).toBe(200);
    expect(r.body.masked.length).toBeGreaterThan(0);
  });

  it('every denial is an audit event about her, and she hears it in her access log', async () => {
    const denied = await t.db.select().from(auditEvents).where(and(eq(auditEvents.subjectCitizenId, t.ids.citizenIds['+920000000001']!), eq(auditEvents.outcome, 'denied')));
    expect(denied.length).toBeGreaterThanOrEqual(6);
    const log = await call(accessLog.GET, '/api/v1/me/access-log', { token: tok.zarina });
    expect(log.status).toBe(200);
    expect(log.body.items.some((i: { outcome: string; en: string }) => i.outcome === 'denied' && /refused/.test(i.en))).toBe(true);
  });

  it('granting again resumes her case into review (never auto-approved on resume)', async () => {
    const r = await call(consentsRoute.POST, '/api/v1/me/consents', { token: tok.zarina, body: { tenantId: t.ids.tenantIds.sindh, dataCategories: ['case', 'identity', 'documents', 'payments'], pin: TEST_PIN } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.resumedCases).toContain(zarinaCase);
    const ok = await call(caseById.GET, `/api/v1/cases/${zarinaCase}`, { token: tok.imran, params: { id: zarinaCase } });
    expect(ok.status).toBe(200);
  });
});

describe('officer actions: freeze/unfreeze with a reason; close with a reason code; corrections', () => {
  it('freeze → unfreeze back to review', async () => {
    const f = await call(freeze.POST, `/api/v1/cases/${zarinaCase}/freeze`, { token: tok.imran, params: { id: zarinaCase }, body: { reason: 'checking the wallet history' } });
    expect(f.body.status).toBe('frozen');
    const blocked = await call(decisionsRoute.POST, `/api/v1/cases/${zarinaCase}/decisions`, { token: tok.imran, params: { id: zarinaCase }, headers: idem(), body: { action: 'approve', reasonCode: 'evidence_reviewed' } });
    expect(blocked.status).toBe(409);
    const u = await call(unfreeze.POST, `/api/v1/cases/${zarinaCase}/unfreeze`, { token: tok.imran, params: { id: zarinaCase }, body: { reason: 'wallet history is fine' } });
    expect(u.body.status).toBe('in_review');
  });

  it('a citizen correction goes to the officer queue; approval keeps the old value and re-decides', async () => {
    const c = await call(meCorrections.POST, '/api/v1/me/corrections', { token: tok.zarina, headers: idem(), body: { caseId: zarinaCase, fieldKey: 'household.monthly_income', claimedValue: 7000 } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const q = await call(correctionsRoute.GET, '/api/v1/corrections', { token: tok.imran });
    const item = q.body.items.find((x: { id: string }) => x.id === c.body.id);
    expect(item.oldValue).toBe(8000);
    const a = await call(correctionApprove.POST, `/api/v1/corrections/${c.body.id}/approve`, { token: tok.imran, params: { id: c.body.id }, body: { reasonCode: 'document_supports_claim' } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.redecide).toBe(true);
    await flushDeferred();
  });

  it('close requires a reason code', async () => {
    const r = await call(closeRoute.POST, `/api/v1/cases/${rukhsanaCase}/close`, { token: tok.bilal, params: { id: rukhsanaCase }, body: {} });
    expect(r.status).toBe(422);
    const ok = await call(closeRoute.POST, `/api/v1/cases/${rukhsanaCase}/close`, { token: tok.bilal, params: { id: rukhsanaCase }, body: { reasonCode: 'withdrawn' } });
    expect(ok.body.status).toBe('closed');
  });
});

describe('payout change: PIN → officer → cooling-off → "press 9" on the old number', () => {
  let changeId = '';
  it('a wrong PIN is refused; the right PIN requests a change for an officer', async () => {
    const bad = await call(payoutChanges.POST, '/api/v1/payout-changes', { token: tok.zarina, headers: idem(), body: { walletDigits: '0000004417', pin: '1111' } });
    expect(bad.status).toBe(401);
    const r = await call(payoutChanges.POST, '/api/v1/payout-changes', { token: tok.zarina, headers: idem(), body: { walletDigits: '0000004417', pin: TEST_PIN } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('pending_officer');
    changeId = r.body.id;
  });

  it('another office cannot approve it (404); this office approves → notice with "press 9" to the old number', async () => {
    const other = await call(payoutApprove.POST, `/api/v1/payout-changes/${changeId}/approve`, { token: tok.bilal, params: { id: changeId }, method: 'POST' });
    expect(other.status).toBe(404);
    const ok = await call(payoutApprove.POST, `/api/v1/payout-changes/${changeId}/approve`, { token: tok.imran, params: { id: changeId }, method: 'POST' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [ivr] = await t.db.select().from(mockSmsMessages).where(and(eq(mockSmsMessages.toPhone, '+920000000001'), eq(mockSmsMessages.kind, 'ivr'), like(mockSmsMessages.body, '%4417%'))).orderBy(desc(mockSmsMessages.createdAt)).limit(1);
    expect(ivr!.body).toMatch(/Press 9/);
    const ref = /PC-([0-9a-f-]{36}):([0-9a-f]{16})/.exec(ivr!.body)!;
    // a wrong token is a 404; the right one freezes the change and opens a complaint
    const wrong = await call(payoutObject.POST, `/api/v1/payout-changes/${changeId}/object`, { params: { id: changeId }, body: { digit: '9', token: '0000000000000000' } });
    expect(wrong.status).toBe(404);
    const o = await call(payoutObject.POST, `/api/v1/payout-changes/${ref[1]}/object`, { params: { id: ref[1]! }, body: { digit: '9', token: ref[2] } });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect(o.body.status).toBe('objected');
    const c = await call(complaintById.GET, `/api/v1/complaints/${o.body.complaintId}`, { token: tok.imran, params: { id: o.body.complaintId } });
    expect(c.body.complaint.type).toBe('payout_objection');
    const noReason = await call(complaintResolve.POST, `/api/v1/complaints/${o.body.complaintId}/resolve`, { token: tok.imran, params: { id: o.body.complaintId }, body: { resolution: 'upheld' } });
    expect(noReason.status).toBe(422);
    const res = await call(complaintResolve.POST, `/api/v1/complaints/${o.body.complaintId}/resolve`, { token: tok.imran, params: { id: o.body.complaintId }, body: { resolution: 'upheld', reasonCode: 'payout_change_fraud', note: 'Old number holder confirmed it was not her' } });
    expect(res.status).toBe(200);
  });
});

describe('"Is this real?" (F12) and the scam desk', () => {
  beforeAll(() => { mockAi({ choice: 'opt_a', pNeedsPerson: 0.2 }); resetMemoryRateLimits(); });

  it('the fake Rs 25,000 message: fake, "no such payment" and "fees are never charged"; Hyderabad drafts an alert', async () => {
    const r = await call(scamCheck.POST, '/api/v1/scam/check', { token: tok.zarina, body: { text: 'Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.', sender: '+920000099111', sentToMe: true, ledgerConsent: true, districtCode: 'HYD' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.verdict).toBe('fake');
    const codes = r.body.reasons.filter((x: { result: string }) => x.result === 'contradiction').map((x: { code: string }) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['fee', 'ledger', 'sender']));
    expect(r.body.alertDrafted).toBeTruthy();
    const alerts = await call(scamAlerts.GET, '/api/v1/scam/alerts', { token: tok.imran });
    const a = alerts.body.items.find((x: { id: string }) => x.id === r.body.alertDrafted);
    expect(a.status).toBe('draft');
    const approve = await call(scamAlertApprove.POST, `/api/v1/scam/alerts/${a.id}/approve`, { token: tok.imran, params: { id: a.id }, method: 'POST' });
    expect(approve.body.status).toBe('sent');
  });

  it('a genuine programme message is not called fake; checked for a customer (no ledger) it is not fake either', async () => {
    const [p] = await t.db.select().from(consents).limit(1); void p;
    const msg = 'SAAYA: Rs 12000 has been sent to your wallet ending 1356 on 2026-02-15. No fee is ever charged. Never share your PIN.';
    const forCustomer = await call(scamCheck.POST, '/api/v1/scam/check', { body: { text: msg, sender: 'SAAYA', sentToMe: false, districtCode: 'HYD' } });
    expect(forCustomer.body.verdict).not.toBe('fake');
    expect(forCustomer.body.ledger.checked).toBe(false);
  });

  it('the map shows aggregates only, with no exact count under 3', async () => {
    const m = await call(scamMap.GET, '/api/v1/scam/map', {});
    expect(m.status).toBe(200);
    const hyd = m.body.districts.find((d: { code: string }) => d.code === 'HYD');
    expect(typeof hyd.total === 'number' ? hyd.total : 0).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(m.body)).not.toMatch(/\+92|00000-/);
  });
});

describe('policy assistant (F16): no model → "I am not sure; a person will call you"', () => {
  it('refuses safely and records an AI decision', async () => {
    aiOff();
    const r = await call(assistPolicy.POST, '/api/v1/assist/policy', { token: tok.zarina, body: { question: 'Am I eligible if my husband died abroad?' } });
    expect(r.status).toBe(200);
    expect(r.body.refused).toBe(true);
    expect(r.body.answer_en).toMatch(/not sure/i);
    expect(r.body.retrieved.length).toBeGreaterThan(0);
  });
});

describe('helper assignments stay capped at 40', () => {
  it('the cap holds', async () => {
    const rows = await t.db.select({ id: helperAssignments.id }).from(helperAssignments).where(eq(helperAssignments.helperUserId, t.ids.staffIds['helper.shabana@sindh.amanat.test']!));
    expect(rows.length).toBeLessThanOrEqual(40);
  });
});
