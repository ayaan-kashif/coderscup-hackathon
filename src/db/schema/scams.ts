import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { users } from './people';
import { districts, tenants } from './tenancy';

export const scamReports = pgTable('scam_reports', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  districtId: uuid('district_id').references(() => districts.id),
  reporterUserId: uuid('reporter_user_id').references(() => users.id),
  messageHash: text('message_hash').notNull(),
  /** raw text kept 90 days, then nulled by the retention sweep */
  messageText: text('message_text'),
  channel: text('channel', { enum: ['text', 'screenshot', 'voice'] }).notNull(),
  verdict: text('verdict', { enum: ['fake', 'genuine', 'not_sure'] }).notNull(),
  scamType: text('scam_type'),
  extractedClaims: jsonb('extracted_claims').notNull(),
  ledgerCheck: jsonb('ledger_check'),
  probabilities: jsonb('probabilities'),
  createdAt: createdAt(),
}, (t) => [index('scam_reports_district_time').on(t.districtId, t.createdAt)]);

export const scamAlerts = pgTable('scam_alerts', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  districtId: uuid('district_id').notNull().references(() => districts.id),
  scamType: text('scam_type').notNull(),
  status: text('status', { enum: ['draft', 'approved', 'sent', 'dismissed'] }).notNull().default('draft'),
  count: integer('count').notNull(),
  windowStart: ts('window_start').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  sentAt: ts('sent_at'),
  createdAt: createdAt(),
});
