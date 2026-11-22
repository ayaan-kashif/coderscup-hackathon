import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { cases } from './cases';
import { payoutChanges } from './money';
import { citizens, users } from './people';
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
  /** the plain-words reasons shown with the verdict (code, result, en, ur): so "My checks" can show them later */
  reasons: jsonb('reasons'),
  /** scam desk: an officer's label settles a "not sure" verdict */
  /** a shopkeeper's confirmed fake counts on the Scam Map and drafts district alerts only after he presses "Report this scam"; every other check counts at once (true) */
  reported: boolean('reported').notNull().default(true),
  officerLabel: text('officer_label', { enum: ['fake', 'genuine'] }),
  labelledBy: uuid('labelled_by').references(() => users.id),
  labelledAt: ts('labelled_at'),
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

/**
 * Silent Duress PIN alarms (DURESS_SILENT_ALARM). Raised when a citizen enters her PIN reversed: the coercer sees a
 * normal screen while the case is shadow-frozen, the payout change held and any helper unlock quarantined.
 * Officer-only (Scam Desk); never shown to the citizen or the helper.
 */
export const duressAlarms = pgTable('duress_alarms', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: text('type').notNull().default('DURESS_SILENT_ALARM'),
  severity: text('severity', { enum: ['CRITICAL'] }).notNull().default('CRITICAL'),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  caseId: uuid('case_id').references(() => cases.id),
  payoutChangeId: uuid('payout_change_id').references(() => payoutChanges.id),
  /** where the reversed PIN was entered */
  trigger: text('trigger', { enum: ['pin_verify', 'payout_change', 'helper_unlock'] }).notNull(),
  helperUserId: uuid('helper_user_id').references(() => users.id),
  helperGrantIds: uuid('helper_grant_ids').array().notNull().default([]),
  /** request id, acting user, IP, user agent, device id: staff-only evidence */
  session: jsonb('session').notNull(),
  /** the attempted payout change: old and new last-4 only */
  attempted: jsonb('attempted'),
  frozenCaseIds: uuid('frozen_case_ids').array().notNull().default([]),
  status: text('status', { enum: ['open', 'confirmed_block', 'escalated', 'marked_safe'] }).notNull().default('open'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: ts('resolved_at'),
  resolutionNote: text('resolution_note'),
  createdAt: createdAt(),
}, (t) => [index('duress_alarms_tenant_status').on(t.tenantId, t.status, t.createdAt)]);
