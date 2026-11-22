/** Evaluation dashboard: speed per pipeline stage (p50/p95) and AI cost per case, with denominators and dates. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, fullSeededDb } from '../helpers/api';
import type { TestDb } from '../helpers/pglite';
import { signAccessToken } from '@/auth/tokens';
import { aiCalls, cases } from '@/db/schema/all';
import { liveMetrics } from '@/services/evaluation';
import * as metricsRoute from '../../app/api/v1/eval/metrics/route';

let t: TestDb & { ids: { staffIds: Record<string, string>; tenantIds: Record<string, string> } };

beforeAll(async () => { t = await fullSeededDb({ demoCases: true }) as never; });
afterAll(async () => { await t?.close(); });

describe('evaluation dashboard: speed and cost', () => {
  it('reports p50/p95 per pipeline stage with the number of cases and the period', async () => {
    const m = await liveMetrics(t.db, t.ids.tenantIds['sindh']!);
    expect(m.stageMs.length).toBeGreaterThan(3);
    const names = m.stageMs.map((s) => s.stage);
    expect(names).toEqual(expect.arrayContaining(['documents', 'identity', 'decide']));
    for (const s of m.stageMs) {
      expect(s.n).toBeGreaterThanOrEqual(1);
      expect(s.p95).toBeGreaterThanOrEqual(s.p50);
      expect(s.from).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(s.to).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it('reports AI cost per case with its denominator, from ai_calls', async () => {
    const sindh = t.ids.tenantIds['sindh']!;
    const [c] = await t.db.select({ id: cases.id }).from(cases).limit(2);
    await t.db.insert(aiCalls).values([
      { tenantId: sindh, caseId: c!.id, purpose: 'extract.cnic', model: 'google/gemini-3.8-flash', status: 'ok', latencyMs: 900, costUsd: '0.004000' },
      { tenantId: sindh, caseId: c!.id, purpose: 'jev.second_opinion', model: 'typesafe-ai/jev', status: 'ok', latencyMs: 300, costUsd: '0.001000' },
    ]);
    const m = await liveMetrics(t.db, sindh);
    expect(m.cost.cases).toBeGreaterThanOrEqual(1);
    expect(m.cost.aiCalls).toBeGreaterThanOrEqual(2);
    expect(m.cost.perCaseUsd).toBeGreaterThan(0);
    expect(m.cost.from).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // and it is served to admins and auditors only, for their own office
    const admin = await signAccessToken({ sub: t.ids.staffIds['admin.sana@sindh.amanat.test']!, kind: 'staff', app_role: 'admin', tid: sindh });
    const r = await call(metricsRoute.GET, '/api/v1/eval/metrics', { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.live.stageMs.length).toBeGreaterThan(0);
    const officer = await signAccessToken({ sub: t.ids.staffIds['officer.imran@sindh.amanat.test']!, kind: 'staff', app_role: 'officer', tid: sindh });
    expect((await call(metricsRoute.GET, '/api/v1/eval/metrics', { token: officer })).status).toBe(403);
  });
});
