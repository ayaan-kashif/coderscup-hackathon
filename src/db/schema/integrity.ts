import { bigint, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, ts } from './_types';

/** Exactly-once writes (API-3): primary key (actor, key), 24-hour expiry. */
export const idempotencyKeys = pgTable('idempotency_keys', {
  actor: text('actor').notNull(),
  key: text('key').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  requestHash: text('request_hash').notNull(),
  status: text('status', { enum: ['in_progress', 'completed'] }).notNull().default('in_progress'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [primaryKey({ name: 'idempotency_keys_pk', columns: [t.actor, t.key] })]);

/** Exported head hashes (AUD-3). */
export const auditAnchors = pgTable('audit_anchors', {
  id: id(),
  chainId: text('chain_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  headHash: bytea('head_hash').notNull(),
  verifiedOk: text('verified_ok').notNull(),
  createdAt: createdAt(),
});
