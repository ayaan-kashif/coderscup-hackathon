import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { chaosSettings, type MockService } from '@/db/schema/all';
import { ApiError } from '@/lib/errors';

export type Chaos = { latencyMs: number; timeoutRate: number; errorRate: number };
export const NO_CHAOS: Chaos = { latencyMs: 0, timeoutRate: 0, errorRate: 0 };

/** How long a simulated timeout hangs before answering 504 (callers' own timeouts fire first). */
export const SIMULATED_TIMEOUT_MS = 10_000;

export async function getChaos(db: DbOrTx, service: MockService): Promise<Chaos> {
  const [row] = await db.select().from(chaosSettings).where(eq(chaosSettings.service, service)).limit(1);
  return row ? { latencyMs: row.latencyMs, timeoutRate: row.timeoutRate, errorRate: row.errorRate } : NO_CHAOS;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  });
}

/** Applies the admin's chaos settings (ADM-2) to one mock request: latency, then a timeout or error roll. */
export async function applyChaos(c: Chaos, service: MockService, signal?: AbortSignal, rand: () => number = Math.random) {
  if (c.latencyMs > 0) await sleep(c.latencyMs, signal);
  if (c.timeoutRate > 0 && rand() < c.timeoutRate) {
    await sleep(SIMULATED_TIMEOUT_MS, signal);
    throw new ApiError('DEPENDENCY_UNAVAILABLE', `Simulated timeout from the mock ${service} service (chaos panel).`, { extra: { simulated: true, chaos: 'timeout' }, headers: { 'X-Chaos': 'timeout' } });
  }
  if (c.errorRate > 0 && rand() < c.errorRate) {
    throw new ApiError('DEPENDENCY_UNAVAILABLE', `Simulated failure from the mock ${service} service (chaos panel).`, { extra: { simulated: true, chaos: 'error' }, headers: { 'X-Chaos': 'error' } });
  }
}
