/**
 * Prompt 3: rule editor → Twin → second admin → publish → re-decide (S11); cost slider; evaluation report;
 * Break It through the live pipeline in the sandbox; break-glass; users and API keys.
 */
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as apiKeys from '../../app/api/v1/admin/api-keys/route';
import * as revokeKey from '../../app/api/v1/admin/api-keys/[id]/revoke/route';
import * as users from '../../app/api/v1/admin/users/route';
import * as access from '../../app/api/v1/audit/access/route';
import * as breakGlass from '../../app/api/v1/audit/break-glass/route';
import * as caseById from '../../app/api/v1/cases/[id]/route';
import * as decisionById from '../../app/api/v1/decisions/[id]/route';
import * as decisionsSearch from '../../app/api/v1/decisions/route';
import * as breakIt from '../../app/api/v1/eval/break-it/route';
import * as costPreview from '../../app/api/v1/eval/cost-preview/route';
import * as evalRun from '../../app/api/v1/eval/runs/[id]/route';
import * as metrics from '../../app/api/v1/eval/metrics/route';
import * as rules from '../../app/api/v1/rules/route';
import * as drafts from '../../app/api/v1/rules/drafts/route';
import * as draftById from '../../app/api/v1/rules/drafts/[id]/route';
import * as approve from '../../app/api/v1/rules/drafts/[id]/approve/route';
import * as preview from '../../app/api/v1/rules/drafts/[id]/preview/route';
import * as publish from '../../app/api/v1/rules/drafts/[id]/publish/route';
import * as twin from '../../app/api/v1/rules/drafts/[id]/twin/route';
import { signAccessToken } from '@/auth/tokens';
import { cases, complaints, decisions } from '@/db/schema/all';
import { flushDeferred } from '@/lib/defer';
import { seededCaseIds } from '@/services/seed/demo-cases';
import { aiOff, aiReset } from '../helpers/ai';
import { call, fullSeededDb, idem } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';

vi.setConfig({ testTimeout: 240_000 });
type Ids = { citizenIds: Record<string, string>; staffIds: Record<string, string>; tenantIds: Record<string, string> };
let t: TestDb & { ids: Ids };
const tok: Record<string, string> = {};
const staff = (email: string, role: 'officer' | 'admin' | 'auditor', tenant: string) => signAccessToken({ sub: t.ids.staffIds[email]!, kind: 'staff', app_role: role, tid: t.ids.tenantIds[tenant]! });

beforeAll(async () => {
  aiOff();
  t = await fullSeededDb({ demoCases: true }) as never;
  tok.sana = await staff('admin.sana@sindh.amanat.test', 'admin', 'sindh');
  tok.omar = await staff('admin.second.omar@sindh.amanat.test', 'admin', 'sindh');
  tok.ayesha = await staff('admin.ayesha@punjab.amanat.test', 'admin', 'punjab');
  tok.breakit = await staff('admin.breakit@sandbox.amanat.test', 'admin', 'sandbox');
  tok.raza = await staff('auditor.raza@sindh.amanat.test', 'auditor', 'sindh');
  tok.imran = await staff('officer.imran@sindh.amanat.test', 'officer', 'sindh');
}, 300_000);
afterAll(async () => { aiReset(); await t.close(); });

describe('rules: draft → validate → preview → Twin → second admin → publish → re-decide (J5, beat 4)', () => {
  let draftId = '';
  let fatimaCase = '';
  it('creates a draft (v4) and refuses an invalid one', async () => {
    const r = await call(drafts.POST, '/api/v1/rules/drafts', { token: tok.sana, body: {} });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.version).toBe(4);
    draftId = r.body.id;
    const list = await call(rules.GET, '/api/v1/rules', { token: tok.sana });
    const d = list.body.versions.find((v: { id: string }) => v.id === draftId);
    const bad = await call(draftById.PUT, `/api/v1/rules/drafts/${draftId}`, { method: 'PUT', token: tok.sana, params: { id: draftId }, body: { rules: [{ id: 'nope' }], thresholds: d.thresholds, costs: d.costs } });
    expect(bad.status).toBe(422);
    // the income limit drops to Rs 5,000 — Fatima (Rs 9,000) becomes ineligible: harm to an in-flight case
    const changed = d.rules.map((x: { id: string; when: unknown }) => (x.id === 'R-INCOME' ? { ...x, when: { all: [{ fact: 'household.monthly_income', op: 'lte', value: 5000 }] } } : x));
    const ok = await call(draftById.PUT, `/api/v1/rules/drafts/${draftId}`, { method: 'PUT', token: tok.sana, params: { id: draftId }, body: { rules: changed, thresholds: d.thresholds, costs: d.costs } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    fatimaCase = (await seededCaseIds(t.db))['seed-fatima-s1']!;
    const pv = await call(preview.POST, `/api/v1/rules/drafts/${draftId}/preview`, { token: tok.sana, params: { id: draftId }, body: { caseId: fatimaCase } });
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(pv.body.draft.rules.find((x: { ruleId: string }) => x.ruleId === 'R-INCOME').result).toBe('fail');
  });

  it('publishing needs a Twin run on this exact draft; the Twin finds the in-flight harm', async () => {
    const early = await call(publish.POST, `/api/v1/rules/drafts/${draftId}/publish`, { token: tok.sana, params: { id: draftId }, body: { expectedActiveRuleSetId: null } });
    expect(early.status).toBe(409);
    const tw = await call(twin.POST, `/api/v1/rules/drafts/${draftId}/twin`, { token: tok.sana, params: { id: draftId }, method: 'POST' });
    expect(tw.status, JSON.stringify(tw.body)).toBe(201);
    expect(tw.body.summary.inFlightHarm).toBeGreaterThan(0);
    expect(tw.body.summary.affected.some((a: { caseId: string; name: string }) => a.caseId === fatimaCase && !a.name.includes('atima'))).toBe(true); // masked
  });

  it('a harmful draft needs a second admin (not its author); another tenant gets 404; stale publish is 409', async () => {
    const list = await call(rules.GET, '/api/v1/rules', { token: tok.sana });
    const active = list.body.activeRuleSetId;
    const noSecond = await call(publish.POST, `/api/v1/rules/drafts/${draftId}/publish`, { token: tok.sana, params: { id: draftId }, body: { expectedActiveRuleSetId: active } });
    expect(noSecond.status).toBe(409);
    expect(noSecond.body.detail).toMatch(/second admin/);
    const self = await call(approve.POST, `/api/v1/rules/drafts/${draftId}/approve`, { token: tok.sana, params: { id: draftId }, method: 'POST' });
    expect(self.status).toBe(403);
    const other = await call(approve.POST, `/api/v1/rules/drafts/${draftId}/approve`, { token: tok.ayesha, params: { id: draftId }, method: 'POST' });
    expect(other.status).toBe(404);
    const ok = await call(approve.POST, `/api/v1/rules/drafts/${draftId}/approve`, { token: tok.omar, params: { id: draftId }, method: 'POST' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stale = await call(publish.POST, `/api/v1/rules/drafts/${draftId}/publish`, { token: tok.sana, params: { id: draftId }, body: { expectedActiveRuleSetId: '00000000-0000-4000-8000-000000000000' } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    const pub = await call(publish.POST, `/api/v1/rules/drafts/${draftId}/publish`, { token: tok.sana, params: { id: draftId }, body: { expectedActiveRuleSetId: active } });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    await flushDeferred();
  });

  it('open cases are re-decided with v4; the in-flight case that got worse goes to an officer with S11; the old decision keeps v3', async () => {
    const ds = await t.db.select().from(decisions).where(and(eq(decisions.caseId, fatimaCase), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt));
    expect(ds.length).toBeGreaterThanOrEqual(2);
    expect(ds[0]!.gates).toContain('S11');
    expect(ds[0]!.ruleSetId).toBe(draftId);
    expect(ds[1]!.ruleSetId).not.toBe(draftId);
    const [k] = await t.db.select({ status: cases.status, route: cases.route }).from(cases).where(eq(cases.id, fatimaCase));
    expect(k!.status).toBe('in_review');
    expect(k!.route).toBe('S11');
  });
});

describe('cost slider (EVAL-2) and evaluation dashboard (EVAL-1)', () => {
  it('Rs 25,000 → 98.0% bar; Rs 5,000 → 90.4%; well under 2 seconds', async () => {
    const a = await call(costPreview.POST, '/api/v1/eval/cost-preview', { token: tok.sana, body: { wrongApproval: 25000, review: 300, delay: 200 } });
    const b = await call(costPreview.POST, '/api/v1/eval/cost-preview', { token: tok.sana, body: { wrongApproval: 5000, review: 300, delay: 200 } });
    expect(a.body.threshold.required).toBeCloseTo(0.9802, 3);
    expect(b.body.threshold.required).toBeCloseTo(0.9038, 3);
    expect(a.body.ms).toBeLessThan(2000);
    expect(a.body.at.split.auto + a.body.at.split.proof + a.body.at.split.person).toBe(100);
    expect(a.body.at.wrongApprovals).toBe(0);
    expect(a.body.at.wrongApprovalUpper95).toBeCloseTo(3 / a.body.at.badCases, 3);
    expect(a.body.curve.length).toBe(61);
  });
  it('the dashboard returns the report with denominators and live numbers', async () => {
    const { runOfflineEval } = await import('@/services/evaluation');
    const rep = await runOfflineEval(t.db);
    console.log('eval', JSON.stringify({ routing: rep.routing, scam: rep.scam, documents: rep.documents, rag: rep.rag }));
    const m = await call(metrics.GET, '/api/v1/eval/metrics', { token: tok.sana });
    expect(m.status).toBe(200);
    expect(m.body.report.routing.wrongApprovals).toHaveProperty('den');
    expect(m.body.live).toHaveProperty('officerOverrides');
  });
});

describe('Break It (§25.4) through the live pipeline in the sandbox', () => {
  it('a real office admin gets 403; the sandbox admin runs 18 attacks + 20 controls + 5 messages', async () => {
    const no = await call(breakIt.POST, '/api/v1/eval/break-it', { token: tok.sana, method: 'POST' });
    expect(no.status).toBe(403);
    const r = await call(breakIt.POST, '/api/v1/eval/break-it', { token: tok.breakit, method: 'POST' });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    await flushDeferred();
    const rep = await call(evalRun.GET, `/api/v1/eval/runs/${r.body.id}`, { token: tok.breakit, params: { id: r.body.id } });
    expect(rep.body.run.status, JSON.stringify(rep.body.run.metrics)).toBe('done');
    const attacks = rep.body.results.filter((x: { attackNo: number | null }) => x.attackNo);
    expect(attacks).toHaveLength(18);
    expect(rep.body.results).toHaveLength(43);
    const by = Object.fromEntries(attacks.map((x: { attackNo: number; result: string; actual: { detail: string } }) => [x.attackNo, `${x.result}: ${x.actual.detail}`]));
    console.log('Break It', JSON.stringify(rep.body.run.metrics), JSON.stringify(by, null, 1), JSON.stringify(rep.body.results.filter((x: { attackNo: number | null; result: string }) => !x.attackNo && x.result !== 'pass')));
    // never an approval for an attack that should stop a case (no "missed" except where the model is needed)
    for (const n of [1, 3, 4, 6, 7, 9, 10, 11, 12, 13, 14, 16, 17, 18]) expect(by[n], `attack ${n}`).not.toMatch(/^missed/);
  });
});

describe('auditor: search, access log, break-glass', () => {
  it('searches case and AI decisions; reads consent + access; break-glass unmasks for 30 minutes and is logged', async () => {
    const s = await call(decisionsSearch.GET, '/api/v1/decisions', { token: tok.raza });
    expect(s.status).toBe(200);
    expect(s.body.items.length).toBeGreaterThan(0);
    const officerSearch = await call(decisionsSearch.GET, '/api/v1/decisions', { token: tok.imran });
    expect(officerSearch.status).toBe(403);
    const caseId = (await seededCaseIds(t.db))['seed-fatima-s1']!;
    const a = await call(access.GET, '/api/v1/audit/access', { token: tok.raza, query: { caseId } });
    expect(a.status).toBe(200);
    expect(a.body.consents.length).toBeGreaterThan(0);
    const [d] = await t.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.caseId, caseId)).limit(1);
    const masked = await call(decisionById.GET, `/api/v1/decisions/${d!.id}`, { token: tok.raza, params: { id: d!.id } });
    expect(masked.body.masked.length).toBeGreaterThan(0);
    const noBasis = await call(breakGlass.POST, '/api/v1/audit/break-glass', { token: tok.raza, body: { caseId, basis: 'open_complaint', reason: 'checking the complaint about this case' } });
    expect(noBasis.status).toBe(422);
    const [cmp] = await t.db.insert(complaints).values({ tenantId: t.ids.tenantIds.sindh!, caseId, citizenId: t.ids.citizenIds['+920000000002']!, type: 'other', channel: 'test', severity: 1 }).returning({ id: complaints.id });
    const bg = await call(breakGlass.POST, '/api/v1/audit/break-glass', { token: tok.raza, body: { caseId, basis: 'open_complaint', complaintId: cmp!.id, reason: 'Complaint says the husband name was misread' } });
    expect(bg.status, JSON.stringify(bg.body)).toBe(201);
    const open = await call(decisionById.GET, `/api/v1/decisions/${d!.id}`, { token: tok.raza, params: { id: d!.id } });
    expect(open.body.breakGlass).toBe(true);
    expect(open.body.masked).toEqual([]);
    const officerView = await call(caseById.GET, `/api/v1/cases/${caseId}`, { token: tok.raza, params: { id: caseId } });
    expect(officerView.status).toBe(200);
  });
});

describe('organisation: users and API keys', () => {
  it('creates a user (.test only), creates and revokes an API key', async () => {
    const bad = await call(users.POST, '/api/v1/admin/users', { token: tok.sana, headers: idem(), body: { email: 'someone@gmail.com', displayName: 'Real Person', role: 'officer' } });
    expect(bad.status).toBe(422);
    const u = await call(users.POST, '/api/v1/admin/users', { token: tok.sana, headers: idem(), body: { email: 'officer.new@sindh.amanat.test', displayName: 'New Officer (fictional)', role: 'officer' } });
    expect(u.status).toBe(201);
    const k = await call(apiKeys.POST, '/api/v1/admin/api-keys', { token: tok.sana, headers: idem(), body: { name: 'Partner NGO (fictional)', scopes: ['scam:check'] } });
    expect(k.status).toBe(201);
    expect(k.body.key).toMatch(/^amk_[a-z0-9]{8}_/);
    const list = await call(apiKeys.GET, '/api/v1/admin/api-keys', { token: tok.sana });
    expect(JSON.stringify(list.body)).not.toContain(k.body.key);
    const otherTenant = await call(revokeKey.POST, `/api/v1/admin/api-keys/${k.body.id}/revoke`, { token: tok.ayesha, params: { id: k.body.id }, method: 'POST' });
    expect(otherTenant.status).toBe(404);
    const rv = await call(revokeKey.POST, `/api/v1/admin/api-keys/${k.body.id}/revoke`, { token: tok.sana, params: { id: k.body.id }, method: 'POST' });
    expect(rv.status).toBe(200);
  });
});
