import { sql } from 'drizzle-orm';
import { check, doublePrecision, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, ts } from './_types';
import { users } from './people';
import { tenants } from './tenancy';

/** Live settings (ADM-3): model IDs, cooling-off periods, costs, auto cap. tenant_id null = global default. */
export const systemConfig = pgTable('system_config', {
  id: id(),
  key: text('key').notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [unique('system_config_key_tenant').on(t.key, t.tenantId).nullsNotDistinct()]);

export const MOCK_SERVICES = ['identity', 'civil', 'ledger', 'sms', 'complaints', 'issuer'] as const;
export type MockService = (typeof MOCK_SERVICES)[number];

/** ADM-2: per mock service latency, timeout rate and error rate. */
export const chaosSettings = pgTable('chaos_settings', {
  service: text('service', { enum: MOCK_SERVICES }).primaryKey(),
  latencyMs: integer('latency_ms').notNull().default(0),
  timeoutRate: doublePrecision('timeout_rate').notNull().default(0),
  errorRate: doublePrecision('error_rate').notNull().default(0),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  check('chaos_latency_range', sql`${t.latencyMs} between 0 and 30000`),
  check('chaos_timeout_rate_range', sql`${t.timeoutRate} between 0 and 1`),
  check('chaos_error_rate_range', sql`${t.errorRate} between 0 and 1`),
]);
