/**
 * Query-side definitions of the two audit-chain tables.
 *
 * The DDL is NOT generated from this file: both tables, the chain trigger, the append-only guard,
 * audit_verify and has_active_consent are created verbatim from PRD §20.3 in
 * src/db/migrations/0002_audit_chain.sql. drizzle.config.ts therefore excludes this file.
 */
import { bigint, bigserial, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from './_types';

export const auditChainHeads = pgTable('audit_chain_heads', {
  chainId: text('chain_id').primaryKey(),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
  lastHash: bytea('last_hash').notNull(),
});

export const auditEvents = pgTable('audit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  chainId: text('chain_id').notNull(),
  seq: bigint('seq', { mode: 'number' }),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  requestId: text('request_id'),
  actorType: text('actor_type', { enum: ['user', 'system', 'ai', 'agent', 'api_key'] }).notNull(),
  actorId: text('actor_id').notNull(),
  tenantId: uuid('tenant_id'),
  subjectCitizenId: uuid('subject_citizen_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  outcome: text('outcome', { enum: ['allowed', 'denied', 'error'] }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  prevHash: bytea('prev_hash'),
  hash: bytea('hash'),
});
