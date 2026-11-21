/**
 * ADM-4 (P2): a tenant's plan sets limits on new cases per month, API-key calls per minute (whole tenant) and AI calls
 * per day. Over the case or API limit the request gets 429 RATE_LIMITED; over the AI limit the model is not called
 * and the caller takes its documented fallback (deterministic path or an officer), exactly as when AI is down.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { aiCalls, cases, plans, tenants } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';

export type PlanLimits = { casesPerMonth: number; apiPerMinute: number; aiCallsPerDay: number };
export const DEFAULT_LIMITS: PlanLimits = { casesPerMonth: 5000, apiPerMinute: 60, aiCallsPerDay: 20000 };

const cache = new Map<string, { at: number; plan: { code: string; name: string; limits: PlanLimits } }>();
const TTL_MS = 30_000;
export const resetPlanCache = () => cache.clear();

export async function planFor(db: DbOrTx, tenantId: string) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const [row] = await db.select({ code: plans.code, name: plans.name, limits: plans.limits }).from(tenants).leftJoin(plans, eq(plans.id, tenants.planId)).where(eq(tenants.id, tenantId)).limit(1);
  const plan = { code: row?.code ?? 'default', name: row?.name ?? 'Default', limits: { ...DEFAULT_LIMITS, ...(row?.limits ?? {}) } };
  cache.set(tenantId, { at: Date.now(), plan });
  return plan;
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
const dayStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

export async function usage(db: DbOrTx, tenantId: string) {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(and(eq(cases.tenantId, tenantId), gte(cases.createdAt, monthStart())));
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(aiCalls).where(and(eq(aiCalls.tenantId, tenantId), gte(aiCalls.createdAt, dayStart()), eq(aiCalls.status, 'ok')));
  return { casesThisMonth: c?.n ?? 0, aiCallsToday: a?.n ?? 0 };
}

export async function assertCaseQuota(db: DbOrTx, tenantId: string) {
  const plan = await planFor(db, tenantId);
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(cases).where(and(eq(cases.tenantId, tenantId), gte(cases.createdAt, monthStart())));
  if ((c?.n ?? 0) >= plan.limits.casesPerMonth) {
    throw new ApiError('RATE_LIMITED', `This office has reached its plan limit of ${plan.limits.casesPerMonth} new applications this month.`, { extra: { limit: 'plan.casesPerMonth' } });
  }
}

/** true when the tenant may make another AI call today */
export async function aiQuotaLeft(db: DbOrTx, tenantId: string | null) {
  if (!tenantId) return true;
  const plan = await planFor(db, tenantId);
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(aiCalls).where(and(eq(aiCalls.tenantId, tenantId), gte(aiCalls.createdAt, dayStart()), eq(aiCalls.status, 'ok')));
  return (a?.n ?? 0) < plan.limits.aiCallsPerDay;
}
