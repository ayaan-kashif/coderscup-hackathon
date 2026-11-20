import { boolean, doublePrecision, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_types';

/** Plan limits (P2 light): cases per month, API requests per minute, AI calls per day. */
export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  limits: jsonb('limits').$type<{ casesPerMonth: number; apiPerMinute: number; aiCallsPerDay: number }>().notNull(),
  createdAt: createdAt(),
});

export const tenants = pgTable('tenants', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameUr: text('name_ur'),
  planId: uuid('plan_id').references(() => plans.id),
  isSandbox: boolean('is_sandbox').notNull().default(false),
  createdAt: createdAt(),
});

/** District centroids for the Scam Map; owned by the tenant (province) that serves them. */
export const districts = pgTable('districts', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nameUr: text('name_ur'),
  province: text('province').notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});
