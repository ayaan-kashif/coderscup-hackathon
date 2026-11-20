import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { users } from './people';
import { tenants } from './tenancy';

export const apiKeys = pgTable('api_keys', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  prefix: text('prefix').notNull().unique(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  ratePerMinute: integer('rate_per_minute').notNull().default(60),
  createdBy: uuid('created_by').references(() => users.id),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  createdAt: createdAt(),
});
