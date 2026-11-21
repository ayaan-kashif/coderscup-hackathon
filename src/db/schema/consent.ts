import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { cases } from './cases';
import { citizens, users } from './people';
import { tenants } from './tenancy';

/** Server-enforced consent (F8). Checked by has_active_consent() before any personal-data read. */
export const consents = pgTable('consents', {
  id: id(),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  granteeType: text('grantee_type', { enum: ['tenant', 'helper'] }).notNull(),
  granteeId: uuid('grantee_id').notNull(),
  purpose: text('purpose').notNull(),
  dataCategories: text('data_categories').array().notNull(),
  status: text('status', { enum: ['active', 'withdrawn', 'expired'] }).notNull().default('active'),
  method: text('method').notNull(),
  noticeVersion: text('notice_version').notNull(),
  expiresAt: ts('expires_at'),
  withdrawnAt: ts('withdrawn_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('consents_one_active').on(t.citizenId, t.granteeType, t.granteeId, t.purpose).where(sql`status = 'active'`),
  index('consents_lookup').on(t.citizenId, t.granteeId, t.purpose),
]);

export const correctionRequests = pgTable('correction_requests', {
  id: id(),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  caseId: uuid('case_id').references(() => cases.id),
  fieldKey: text('field_key').notNull(),
  claimedValue: jsonb('claimed_value').notNull(),
  oldValue: jsonb('old_value'),
  reasonCode: text('reason_code'),
  note: text('note'),
  status: text('status', { enum: ['open', 'approved', 'rejected'] }).notNull().default('open'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  createdAt: createdAt(),
});
