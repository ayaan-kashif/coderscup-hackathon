/** Prompt 4 remaining PRD items: ADM-4 plan limits, OFF-8 STATUS by SMS, CONS-8 data export. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { aiCall } from '@/ai/calls';
import { AiUnavailable } from '@/ai/runtime';
import { aiCalls, cases, citizens, plans, tenants, users } from '@/db/schema/all';
import { mockSmsMessages } from '@/db/schema/mock';
import { resetPlanCache } from '@/services/plans';
import { dispatchMock } from '@/services/mocks/router';
import * as casesRoute from '../../app/api/v1/cases/route';
import * as planRoute from '../../app/api/v1/admin/plan/route';
import * as exportRoute from '../../app/api/v1/me/export/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };
const FATIMA = '+920000000002';

const citizenToken = async (phone: string) => {
  const [u] = await t.db.select({ id: users.id, cid: citizens.id }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, phone)).limit(1);
  return signAccessToken({ sub: u!.id, kind: 'citizen', app_role: 'citizen', cid: u!.cid, stage: 'full' });
};

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; });
afterAll(async () => { resetPlanCache(); await t?.close(); });

describe('ADM-4 plan limits', () => {
  it('a full monthly case quota returns 429; a repeat of an existing submission still works', async () => {
    const sindh = t.ids.tenantIds['sindh']!;
    const tok = await citizenToken('+920000000001');
    const first = await call(casesRoute.POST, '/api/v1/cases', { token: tok, headers: { 'idempotency-key': 'plan-key-0001' }, body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'plan-test-0001' } });
    expect(first.status).toBe(201);

    const [tn] = await t.db.select({ planId: tenants.planId }).from(tenants).where(eq(tenants.id, sindh));
    const n = await t.db.execute(`select count(*)::int as n from cases where tenant_id = '${sindh}'`).then((r) => (r as unknown as { rows: { n: number }[] }).rows[0]!.n);
    const [orig] = await t.db.select().from(plans).where(eq(plans.id, tn!.planId!));
    await t.db.update(plans).set({ limits: { ...orig!.limits, casesPerMonth: n } }).where(eq(plans.id, orig!.id));
    resetPlanCache();

    const over = await call(casesRoute.POST, '/api/v1/cases', { token: tok, headers: { 'idempotency-key': 'plan-key-0002' }, body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'plan-test-0002' } });
    expect(over.status).toBe(429);
    expect(over.body.limit).toBe('plan.casesPerMonth');
    const again = await call(casesRoute.POST, '/api/v1/cases', { token: tok, headers: { 'idempotency-key': 'plan-key-0003' }, body: { programCode: 'SAAYA-WS', channel: 'citizen', clientSubmissionId: 'plan-test-0001' } });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);

    const admin = await signAccessToken({ sub: t.ids.staffIds['admin.sana@sindh.amanat.test']!, kind: 'staff', app_role: 'admin', tid: sindh });
    const pu = await call(planRoute.GET, '/api/v1/admin/plan', { token: admin });
    expect(pu.status).toBe(200);
    expect(pu.body.usage.casesThisMonth).toBe(n);

    // AI calls over the daily cap are not made; the caller sees AiUnavailable (its fallback runs) and it is logged
    await t.db.update(plans).set({ limits: { ...orig!.limits, aiCallsPerDay: 0 } }).where(eq(plans.id, orig!.id));
    resetPlanCache();
    let called = false;
    await expect(aiCall({ db: t.db, tenantId: sindh, purpose: 'test', model: 'x/y' }, async () => { called = true; return {}; })).rejects.toBeInstanceOf(AiUnavailable);
    expect(called).toBe(false);
    const [log] = await t.db.select().from(aiCalls).where(eq(aiCalls.purpose, 'test')).orderBy(desc(aiCalls.createdAt)).limit(1);
    expect(log!.error).toMatch(/PlanLimit/);

    await t.db.update(plans).set({ limits: orig!.limits }).where(eq(plans.id, orig!.id));
    resetPlanCache();
  });
});

describe('OFF-8 STATUS by SMS (simulated)', () => {
  it('replies with the case state, the trust picture, and no link', async () => {
    const r = await dispatchMock(t.db, 'POST', 'sms/inbound', {}, { from: FATIMA, to: '8171', body: 'status' });
    expect(r.status).toBe(201);
    const [k] = await t.db.select({ status: cases.status }).from(cases).innerJoin(citizens, eq(citizens.id, cases.citizenId)).innerJoin(users, eq(users.id, citizens.userId)).where(eq(users.phone, FATIMA)).orderBy(desc(cases.updatedAt)).limit(1);
    expect((r.body as unknown as { status: string }).status).toBe(k!.status);
    const [reply] = await t.db.select().from(mockSmsMessages).where(eq(mockSmsMessages.toPhone, FATIMA)).orderBy(desc(mockSmsMessages.createdAt)).limit(1);
    expect(reply!.fromSender).toMatch(/8171/);
    expect(reply!.body).toMatch(/Nobody will ask you for money/);
    expect(reply!.body).not.toMatch(/https?:|www\./);

    const help = await dispatchMock(t.db, 'POST', 'sms/inbound', {}, { from: FATIMA, to: '8171', body: 'hello' });
    expect((help.body as unknown as { status: string | null }).status).toBeNull();
    const unknown = await dispatchMock(t.db, 'POST', 'sms/inbound', {}, { from: '+920000009999', to: '8171', body: 'STATUS' });
    expect((unknown.body as unknown as { status: string | null }).status).toBeNull();
  });
});

describe('CONS-8 data export', () => {
  it('returns only her own data as a JSON download, without secrets', async () => {
    const tok = await citizenToken(FATIMA);
    const r = await call(exportRoute.GET, '/api/v1/me/export', { token: tok });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="amanat-my-data-/);
    expect(r.body.format).toBe('amanat-export@1');
    expect(r.body.profile.phone).toBe(FATIMA);
    expect(r.body.profile.cnic).toMatch(/^\d{5}-\d{7}-\d$/);
    expect(r.body.cases.length).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toMatch(/pin_?hash|otp_?hash|\$argon2/i);

    const staff = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: t.ids.tenantIds['sindh']! });
    expect((await call(exportRoute.GET, '/api/v1/me/export', { token: staff })).status).toBe(403);
  });
});

describe('hybrid policy retrieval (pgvector + keyword, RRF)', () => {
  it('embeds clauses, then fuses vector and keyword ranks; keyword only when embeddings are down', async () => {
    const { MockEmbeddingModelV4 } = await import('ai/test');
    const { setAiResolvers } = await import('@/ai/runtime');
    const { embedPolicyChunks, retrieveClauses } = await import('@/ai/policy');
    const bag = (s: string) => {
      const v = new Array(768).fill(0);
      for (const w of s.toLowerCase().match(/[a-z]{3,}/g) ?? []) { let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 768; v[h] += 1; }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    };
    setAiResolvers({ available: () => true, embedding: () => new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map((x) => bag(String(x))), warnings: [] }) }) as never });
    try {
      const r = await embedPolicyChunks(t.db);
      expect(r.embedded).toBeGreaterThan(0);
      const left = await t.db.execute('select count(*)::int as n from policy_chunks where embedding is null').then((x) => (x as unknown as { rows: { n: number }[] }).rows[0]!.n);
      expect(left).toBe(0);
      const hits = await retrieveClauses(t.db, 'am I eligible if my husband died abroad', 4);
      expect(hits.length).toBe(4);
      const q = await t.db.select().from(aiCalls).where(eq(aiCalls.purpose, 'policy.embed_query'));
      expect(q.length).toBeGreaterThanOrEqual(1);
      setAiResolvers({ available: () => false });
      const kwOnly = await retrieveClauses(t.db, 'am I eligible if my husband died abroad', 4);
      expect(kwOnly.length).toBe(4);
    } finally { setAiResolvers(undefined); }
  });
});

describe('EVAL-4 label-swap test', () => {
  it('flags a model that follows key names, passes one that reads descriptions, and reports "needs key" offline', async () => {
    const { mockAi, aiReset } = await import('../helpers/ai');
    const { setAiResolvers } = await import('@/ai/runtime');
    const { Experimental_DecisionMockModelV4 } = await import('ai/test');
    const { labelSwapEval } = await import('@/services/evaluation');
    try {
      // always "opt_a": follows the name, so the meaning flips when keys rotate
      mockAi();
      const byName = await labelSwapEval(t.db, 6);
      expect(byName.compared).toBe(6);
      expect(byName.changed!.value).toBe(1);

      // reads the descriptions: always the fee description, whatever key it sits under
      setAiResolvers({
        available: () => true,
        decision: () => new Experimental_DecisionMockModelV4({
          provider: 'typesafe-ai', modelId: 'jev-test', supportedQuestionTypes: ['choice', 'boolean', 'score'],
          doDecide: async (opts: { questions: Record<string, { type: string; criteria?: Record<string, string> }> }) => {
            const answers: Record<string, unknown> = {};
            for (const [k, q] of Object.entries(opts.questions)) {
              if (q.type === 'boolean') answers[k] = { type: 'boolean', probability: 0.1 };
              else { const key = Object.entries(q.criteria!).find(([, d]) => d.includes('pay money'))![0]; const keys = Object.keys(q.criteria!); answers[k] = { type: 'choice', choice: key, probabilities: Object.fromEntries(keys.map((x) => [x, x === key ? 0.9 : 0.025])) }; }
            }
            return { answers, usage: { inputTokens: 10, outputTokens: 0 }, warnings: [] };
          },
        } as never) as never,
      });
      const byDesc = await labelSwapEval(t.db, 6);
      expect(byDesc.failed).toBe(0);
      expect(byDesc.changed!.value).toBe(0);

      setAiResolvers({ available: () => false });
      const off = await labelSwapEval(t.db, 6);
      expect(off.changed).toBeNull();
      expect(off.note).toMatch(/gateway key/);
    } finally { aiReset(); }
  });
});

describe('RULE-9 rule suggestions from a policy notice', () => {
  it('validates the proposal, returns a diff, saves nothing; 503 without a key; non-admins 403', async () => {
    const { mockAi, aiReset } = await import('../helpers/ai');
    const { createDraft } = await import('@/services/rules');
    const { ruleSets } = await import('@/db/schema/all');
    const suggest = await import('../../app/api/v1/rules/drafts/[id]/suggest/route');
    const sindh = t.ids.tenantIds['sindh']!;
    const adminId = t.ids.staffIds['admin.sana@sindh.amanat.test']!;
    const draft = await createDraft(t.db, sindh, adminId);
    const rules = draft.rules as { id: string; text_en: string }[];
    const target = { ...rules[0]!, text_en: 'Changed by the notice for review.' };
    const notice = 'Notice 7/2026: the explanation for the first rule changes. Changed by the notice for review.';
    const admin = await signAccessToken({ sub: adminId, kind: 'staff', app_role: 'admin', tid: sindh });
    try {
      mockAi({ object: () => ({ summary: 'One explanation updated.', upsert: [target], remove: [], quotes: ['Changed by the notice for review.', 'invented sentence'] }) });
      const r = await call(suggest.POST, `/api/v1/rules/drafts/${draft.id}/suggest`, { token: admin, params: { id: draft.id }, body: { notice } });
      expect(r.status).toBe(200);
      expect(r.body.saved).toBe(false);
      expect(r.body.diff.changed).toEqual([target.id]);
      expect(r.body.quotes).toEqual(['Changed by the notice for review.']);
      const [after] = await t.db.select({ rules: ruleSets.rules }).from(ruleSets).where(eq(ruleSets.id, draft.id));
      expect(JSON.stringify(after!.rules)).toBe(JSON.stringify(draft.rules));

      mockAi({ object: () => ({ summary: 'bad', upsert: [{ id: 'not-a-rule' }], remove: [], quotes: [] }) });
      expect((await call(suggest.POST, `/api/v1/rules/drafts/${draft.id}/suggest`, { token: admin, params: { id: draft.id }, body: { notice } })).status).toBe(422);

      aiReset();
      const { setAiResolvers } = await import('@/ai/runtime');
      setAiResolvers({ available: () => false });
      expect((await call(suggest.POST, `/api/v1/rules/drafts/${draft.id}/suggest`, { token: admin, params: { id: draft.id }, body: { notice } })).status).toBe(503);
      const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: sindh });
      expect((await call(suggest.POST, `/api/v1/rules/drafts/${draft.id}/suggest`, { token: officer, params: { id: draft.id }, body: { notice } })).status).toBe(403);
    } finally { aiReset(); }
  });
});

describe('A7 tenant analytics', () => {
  it('returns a funnel and the other sections for this tenant only, filterable by district', async () => {
    const analytics = await import('../../app/api/v1/admin/analytics/route');
    const sindh = t.ids.tenantIds['sindh']!;
    const admin = await signAccessToken({ sub: t.ids.staffIds['admin.sana@sindh.amanat.test']!, kind: 'staff', app_role: 'admin', tid: sindh });
    const r = await call(analytics.GET, '/api/v1/admin/analytics', { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.funnel.map((f: { step: string }) => f.step)).toEqual(['applied', 'submitted', 'decided', 'approved', 'paid', 'confirmed']);
    expect(r.body.funnel[0].n).toBeGreaterThan(0);
    for (let i = 1; i < r.body.funnel.length; i++) expect(r.body.funnel[i].n).toBeLessThanOrEqual(r.body.funnel[i - 1].n);
    expect(r.text).not.toMatch(/\d{5}-\d{7}-\d/);
    const d = await call(analytics.GET, '/api/v1/admin/analytics', { token: admin, query: { district: 'BDN' } });
    expect(d.status).toBe(200);
    expect(d.body.funnel[0].n).toBeLessThanOrEqual(r.body.funnel[0].n);
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: sindh });
    expect((await call(analytics.GET, '/api/v1/admin/analytics', { token: officer })).status).toBe(403);
  });
});

describe('bounded verification agent (P1 stretch)', () => {
  it('calls read-only tools (audited as agent), returns a valid bundle; an invalid bundle is ignored', async () => {
    const { MockLanguageModelV4 } = await import('ai/test');
    const { setAiResolvers } = await import('@/ai/runtime');
    const { runVerificationAgent, agentEnabled } = await import('@/ai/verification-agent');
    const { auditEvents } = await import('@/db/schema/all');
    const [k] = await t.db.select({ id: cases.id, tenantId: cases.tenantId, citizenId: cases.citizenId }).from(cases).where(eq(cases.tenantId, t.ids.tenantIds['sindh']!)).limit(1);
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
    const bundle = { checked: ['documents.verifyQr'], findings: [{ source: 'documents', fact: 'qr', value: 'valid', agrees: true }], concerns: [{ code: 'no_death_record', detail: 'test' }], needsPerson: true };
    const script = (final: unknown) => {
      let n = 0;
      return new MockLanguageModelV4({
        doGenerate: async () => {
          n++;
          if (n === 1) return { content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'documents_verifyQr', input: '{}' }], finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [] };
          return { content: [{ type: 'text', text: JSON.stringify(final) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
        },
      });
    };
    process.env.VERIFICATION_AGENT = 'on';
    try {
      setAiResolvers({ available: () => true, language: () => script(bundle) as never });
      expect(agentEnabled()).toBe(true);
      const ok = await runVerificationAgent(t.db, k!);
      expect(ok.ok).toBe(true);
      if (ok.ok) { expect(ok.bundle.needsPerson).toBe(true); expect(ok.steps).toBeLessThanOrEqual(8); expect(ok.completeness).toBe(0.25); }
      const tools = await t.db.select().from(auditEvents).where(and(eq(auditEvents.resourceId, k!.id), eq(auditEvents.action, 'tool.documents.verifyQr')));
      expect(tools.length).toBeGreaterThanOrEqual(1);
      expect(tools[0]!.actorType).toBe('agent');

      setAiResolvers({ available: () => true, language: () => script({ needsPerson: 'yes' }) as never });
      const bad = await runVerificationAgent(t.db, k!);
      expect(bad.ok).toBe(false);
    } finally { delete process.env.VERIFICATION_AGENT; setAiResolvers(undefined); }
    expect(agentEnabled()).toBe(false);
  });
});
