import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { idempotencyKeys } from '@/db/schema/all';
import { ApiError } from './errors';

export const IDEMPOTENCY_TTL_HOURS = 24;

export type StoredResponse = { status: number; body: unknown };

/**
 * Claims (actor, key) inside the request's transaction. A concurrent duplicate blocks on the primary key
 * until the first transaction commits, then sees the completed row and replays it — so a key is acted on once.
 */
export async function claimIdempotencyKey(tx: Tx, p: { actor: string; key: string; method: string; path: string; requestHash: string }): Promise<StoredResponse | null> {
  // expired keys may be reused
  await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.actor, p.actor), eq(idempotencyKeys.key, p.key), sql`${idempotencyKeys.expiresAt} < now()`));
  const inserted = await tx.insert(idempotencyKeys).values({
    actor: p.actor, key: p.key, method: p.method, path: p.path, requestHash: p.requestHash,
    expiresAt: sql`now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})` as unknown as Date,
  }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
  if (inserted.length > 0) return null;

  const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.actor, p.actor), eq(idempotencyKeys.key, p.key))).limit(1);
  if (!row) throw new ApiError('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still running. Retry shortly.');
  if (row.requestHash !== p.requestHash || row.method !== p.method || row.path !== p.path) {
    throw new ApiError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request. Use a new key for a new request.');
  }
  if (row.status !== 'completed') throw new ApiError('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still running. Retry shortly.');
  return { status: row.responseStatus ?? 200, body: row.responseBody };
}

export async function completeIdempotencyKey(tx: Tx, actor: string, key: string, res: StoredResponse) {
  await tx.update(idempotencyKeys).set({ status: 'completed', responseStatus: res.status, responseBody: res.body as object })
    .where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)));
}
