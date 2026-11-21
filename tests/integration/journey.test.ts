/**
 * G2 / G3 core: a case from the citizen's phone reaches an officer with a full trace, the officer approves it,
 * replaying gives the same decision, and the audit chain verifies. Plus J1's proof → approval → payment → receipt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as answersRoute from '../../app/api/v1/cases/[id]/answers/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as decisionsRoute from '../../app/api/v1/cases/[id]/decisions/route';
import * as documentsRoute from '../../app/api/v1/cases/[id]/documents/route';
import * as explanationRoute from '../../app/api/v1/cases/[id]/explanation/route';
import * as proofRoute from '../../app/api/v1/cases/[id]/proof/route';
import * as statusRoute from '../../app/api/v1/cases/[id]/status/route';
import * as submitRoute from '../../app/api/v1/cases/[id]/submit/route';
import * as timelineRoute from '../../app/api/v1/cases/[id]/timeline/route';
import * as casesRoute from '../../app/api/v1/cases/route';
import * as replayRoute from '../../app/api/v1/decisions/[id]/replay/route';
import * as receiptRoute from '../../app/api/v1/payments/[id]/receipt/route';
import * as queueRoute from '../../app/api/v1/queue/route';
import * as verifyRoute from '../../app/api/v1/audit/verify/route';
import * as complaintsRoute from '../../app/api/v1/complaints/route';
import { signAccessToken } from '@/auth/tokens';
import { aiCalls, cases, citizens, decisions, mockLedgerTransactions, payments, systemConfig, users } from '@/db/schema/all';
import { flushDeferred } from '@/lib/defer';
import { payIfDue } from '@/services/pipeline/steps';
import { seededCaseIds } from '@/services/seed/demo-cases';
import { aiReset, mockAi, personaExtraction } from '../helpers/ai';
import { call, fullSeededDb, idem } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 120_000 });

let t: TestDb & { ids: { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> } };
const doc = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../data/documents', f)).toString('base64');

async function citizenToken(phone: string) {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
  return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
}
async function staffToken(email: string, role: 'officer' | 'admin' | 'auditor' | 'helper', tenant: string, senior = false) {
  return signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]!, senior });
}

beforeAll(async () => {
  t = await fullSeededDb({ demoCases: true }) as never;
  // cooling-off 0 minutes so the payment can be released in the test
  await t.db.update(systemConfig).set({ value: 0 }).where(eq(systemConfig.key, 'cooling_off.approval_minutes'));
}, 240_000);
afterAll(async () => { aiReset(); await t.close(); });

describe('J1: Zarina applies, proves, is approved, paid, and reports the exact amount', () => {
  let caseId = '';
  let token = '';

  it('creates a draft, answers by voice/icon/keypad and uploads three photos', async () => {
    mockAi({ object: personaExtraction, pNeedsPerson: 0.04 });
    token = await citizenToken('+920000000001');
    const c = await call(casesRoute.POST, '/api/v1/cases', { token, headers: idem(), body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'zarina-phone-0001' } });
    expect(c.status).toBe(201);
    caseId = c.body.id;
    const a = await call(answersRoute.PATCH, `/api/v1/cases/${caseId}/answers`, { method: 'PATCH', token, params: { id: caseId }, body: { answers: [
      { question: 'name', value: 'Mst. Zarina Bibi', via: 'voice' },
      { question: 'husband_name', value: 'Mohd. Aslam', via: 'voice' },
      { question: 'district', value: 'BDN', via: 'icon' },
      { question: 'husband_died', value: 'haan', via: 'voice' },
      { question: 'remarried', value: false, via: 'icon' },
      { question: 'income', value: 8000, via: 'keypad' },
    ] } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    for (const [docType, f] of [['cnic_front', 'persona-zarina-cnic_front.png'], ['cnic_back', 'persona-zarina-cnic_back.png'], ['death_certificate', 'persona-zarina-death_certificate-blurred.png']]) {
      const key = `up-${docType}`;
      const r = await call(documentsRoute.POST, `/api/v1/cases/${caseId}/documents`, { token, params: { id: caseId }, headers: idem(key), body: { docType, dataBase64: doc(f!) } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      if (docType === 'death_certificate') expect(r.body.retake).toBe(true);
      // OFF-4: a dropped upload resent whole is the same document
      const again = await call(documentsRoute.POST, `/api/v1/cases/${caseId}/documents`, { token, params: { id: caseId }, headers: idem(`${key}-retry`), body: { docType, dataBase64: doc(f!) } });
      expect(again.body.documentId).toBe(r.body.documentId);
    }
  });

  it('submits (Idempotency-Key required) and the pipeline asks for one clear photo', async () => {
    const noKey = await call(submitRoute.POST, `/api/v1/cases/${caseId}/submit`, { token, params: { id: caseId }, method: 'POST' });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const s = await call(submitRoute.POST, `/api/v1/cases/${caseId}/submit`, { token, params: { id: caseId }, method: 'POST', headers: idem('submit-key-0001') });
    expect(s.status).toBe(202);
    await flushDeferred();
    const st = await call(statusRoute.GET, `/api/v1/cases/${caseId}/status`, { token, params: { id: caseId } });
    expect(st.status).toBe(200);
    expect(st.text.length).toBeLessThan(10_000); // OFF-6
    expect(st.body.status, JSON.stringify(st.body)).toBe('needs_proof');
    expect(st.body.proof).toEqual({ item: 'death_certificate', attemptsLeft: 2 });
    expect(st.body.next.code).toBe('proof_death_certificate');
  });

  it('a clear retake → auto-approved with a cooling-off hold; every model call was logged', async () => {
    const p = await call(proofRoute.POST, `/api/v1/cases/${caseId}/proof`, { token, params: { id: caseId }, headers: idem('proof-key-0001'), body: { item: 'death_certificate', docType: 'death_certificate', dataBase64: doc('persona-zarina-death_certificate.png') } });
    expect(p.status, JSON.stringify(p.body)).toBe(202);
    await flushDeferred();
    const [d] = await t.db.select().from(decisions).where(eq(decisions.caseId, caseId)).orderBy(sql`created_at desc`).limit(1);
    expect(d!.outcome, JSON.stringify({ gates: d!.gates, p: d!.pLegit, th: d!.threshold })).toBe('AUTO_APPROVE');
    expect(d!.gates).toEqual([]);
    expect(d!.pLegit!).toBeGreaterThan(d!.threshold!);
    const [k] = await t.db.select({ status: cases.status }).from(cases).where(eq(cases.id, caseId));
    expect(k!.status).toBe('approved_on_hold');
    const logged = await t.db.select().from(aiCalls).where(eq(aiCalls.caseId, caseId));
    expect(logged.some((x) => x.purpose === 'extract.cnic_front' && x.status === 'ok')).toBe(true);
    expect(logged.some((x) => x.purpose === 'jev.second_opinion')).toBe(true);
  });

  it('the hold expires → the mock ledger pays the exact amount → "received less" files a high-severity complaint', async () => {
    const [p] = await t.db.select().from(payments).where(eq(payments.caseId, caseId));
    const r = await payIfDue(t.db, p!.id, new Date(Date.now() + 1000));
    expect(r.paid, JSON.stringify(r)).toBe(true);
    const [l] = await t.db.select().from(mockLedgerTransactions).where(eq(mockLedgerTransactions.idempotencyKey, `pay-${p!.id}`));
    expect(l!.amount).toBe(12000);
    // replaying the payment never pays twice
    expect((await payIfDue(t.db, p!.id)).paid).toBe(false);
    const rc = await call(receiptRoute.POST, `/api/v1/payments/${p!.id}/receipt`, { token, params: { id: p!.id }, headers: idem(), body: { received: 'less', amountReceived: 10000 } });
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    expect(rc.body.complaint.amountMissing).toBe(2000);
    expect(rc.body.complaint.severity).toBe(3);
    const officer = await staffToken('officer.imran@sindh.amanat.test', 'officer', 'sindh');
    const q = await call(complaintsRoute.GET, '/api/v1/complaints', { token: officer });
    expect(q.body.items.some((x: { id: string }) => x.id === rc.body.complaint.id)).toBe(true);
  });
});

describe('G2: the two-Fatima case reaches an officer with a full trace; approve; replay; chain verifies', () => {
  let caseId = '';
  let officer = '';
  it('is in the queue under stop S1', async () => {
    caseId = (await seededCaseIds(t.db))['seed-fatima-s1']!;
    officer = await staffToken('officer.imran@sindh.amanat.test', 'officer', 'sindh');
    const q = await call(queueRoute.GET, '/api/v1/queue', { token: officer, query: { stop: 'S1' } });
    expect(q.status).toBe(200);
    expect(q.body.items.map((x: { id: string }) => x.id)).toContain(caseId);
  });

  it('the case view leads with the stop, the summary, sources, the rule trace and both candidates; opening turns ticks blue', async () => {
    const v = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: officer, params: { id: caseId }, query: { view: 'full' } });
    expect(v.status).toBe(200);
    const sd = v.body.systemDecision;
    expect(sd.gates).toContain('S1');
    expect(sd.summary.why_stopped.length).toBeGreaterThan(0);
    expect(sd.facts.some((f: { source: string }) => f.source === 'registry')).toBe(true);
    expect(sd.ruleTrace.length).toBeGreaterThan(0);
    expect(v.body.matches.length).toBeGreaterThanOrEqual(2);
    const fatima = await citizenToken('+920000000002');
    const st = await call(statusRoute.GET, `/api/v1/cases/${caseId}/status`, { token: fatima, params: { id: caseId } });
    expect(st.body.ticks).toBe('blue2');
  });

  it('rejecting without a reason code is impossible; approving with a reason writes an officer decision', async () => {
    const bad = await call(decisionsRoute.POST, `/api/v1/cases/${caseId}/decisions`, { token: officer, params: { id: caseId }, headers: idem(), body: { action: 'reject', note: 'no reason code here' } });
    expect(bad.status).toBe(422);
    const ok = await call(decisionsRoute.POST, `/api/v1/cases/${caseId}/decisions`, { token: officer, params: { id: caseId }, headers: idem(), body: { action: 'approve', reasonCode: 'identity_confirmed_by_document', note: "Husband's name on the certificate matches candidate B" } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.outcome).toBe('APPROVED');
    expect(ok.body.status).toBe('approved_on_hold');
    const tl = await call(timelineRoute.GET, `/api/v1/cases/${caseId}/timeline`, { token: officer, params: { id: caseId } });
    expect(tl.body.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['tool.identity.search', 'decision.create', 'case.open', 'case.decide']));
    const ex = await call(explanationRoute.GET, `/api/v1/cases/${caseId}/explanation`, { token: officer, params: { id: caseId } });
    expect(ex.body.view).toBe('officer');
    // an officer may not read the auditor view
    const wrong = await call(explanationRoute.GET, `/api/v1/cases/${caseId}/explanation`, { token: officer, params: { id: caseId }, query: { view: 'auditor' } });
    expect(wrong.status).toBe(403);
  });

  it('replaying the decision gives the identical decision (auditor), and the audit chain verifies', async () => {
    const auditor = await staffToken('auditor.raza@sindh.amanat.test', 'auditor', 'sindh');
    const [d] = await t.db.select().from(decisions).where(and(eq(decisions.caseId, caseId), eq(decisions.actorType, 'officer'))).limit(1);
    const r = await call(replayRoute.POST, `/api/v1/decisions/${d!.id}/replay`, { token: auditor, params: { id: d!.id }, method: 'POST' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.identical).toBe(true);
    expect(r.body.replayed.gates).toEqual(r.body.stored.gates);
    expect(r.body.officerOverride.reasonCode).toBe('identity_confirmed_by_document');
    const v = await call(verifyRoute.POST, '/api/v1/audit/verify', { token: auditor, method: 'POST', body: {} });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.intact).toBe(true);
  });
});
