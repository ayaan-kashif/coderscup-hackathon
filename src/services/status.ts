import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import { auditChainHeads } from '@/db/schema/all';
import { verifyChain } from '@/lib/audit';
import { isDemoMode } from '@/lib/env';
import { rateLimitBackendName } from '@/lib/rate-limit';
import { breakerSnapshots } from './adapters';
import { listChaos } from './config';

type Health = 'ok' | 'degraded' | 'down';

export async function getSystemStatus(db: DbOrTx) {
  const checks: Record<string, { status: Health; detail?: unknown; ms?: number }> = {};
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
    checks.database = { status: 'ok', ms: Date.now() - t0 };
  } catch (e) {
    checks.database = { status: 'down', detail: e instanceof Error ? e.message.split('\n')[0] : 'error' };
    return { overall: 'down' as Health, checks, chains: [], time: new Date().toISOString() };
  }

  checks.rateLimiter = { status: rateLimitBackendName() === 'upstash' ? 'ok' : 'degraded', detail: rateLimitBackendName() === 'upstash' ? 'upstash' : 'in-memory fallback (per instance)' };

  const chaos = await listChaos(db);
  const breakers = Object.fromEntries(breakerSnapshots().map((b) => [b.service, b.state]));
  checks.mocks = {
    status: chaos.some((c) => c.errorRate > 0 || c.timeoutRate > 0 || c.latencyMs > 0) || Object.values(breakers).some((s) => s !== 'closed') ? 'degraded' : 'ok',
    detail: chaos.map((c) => ({ service: c.service, simulated: true, latencyMs: c.latencyMs, timeoutRate: c.timeoutRate, errorRate: c.errorRate, circuit: breakers[c.service] ?? 'closed' })),
  };

  const tables = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from pg_tables where schemaname in ('public','mock')`))[0]?.n ?? 0;
  checks.schema = { status: tables === 52 ? 'ok' : 'degraded', detail: { tables, expected: 52 } };

  const heads = await db.select({ chainId: auditChainHeads.chainId }).from(auditChainHeads);
  const chains = [];
  for (const h of heads) {
    const v = await verifyChain(db, h.chainId);
    chains.push({ chainId: h.chainId.startsWith('tenant:') ? `tenant:${h.chainId.slice(7, 15)}…` : h.chainId, intact: v.intact, length: v.length, brokenAt: v.brokenAt, missingTail: v.missingTail });
  }
  checks.auditChain = { status: chains.every((c) => c.intact) ? 'ok' : 'down', detail: { chains: chains.length, intact: chains.filter((c) => c.intact).length } };

  const overall: Health = Object.values(checks).some((c) => c.status === 'down') ? 'down' : Object.values(checks).some((c) => c.status === 'degraded') ? 'degraded' : 'ok';
  return { overall, checks, chains, demoMode: isDemoMode(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev', time: new Date().toISOString() };
}
