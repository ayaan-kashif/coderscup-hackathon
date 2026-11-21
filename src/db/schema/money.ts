import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, ts } from './_types';
import { cases } from './cases';
import { citizens, users } from './people';
import { tenants } from './tenancy';

export const payoutDestinations = pgTable('payout_destinations', {
  id: id(),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  kind: text('kind', { enum: ['wallet', 'bank'] }).notNull().default('wallet'),
  provider: text('provider').notNull(),
  walletEnc: bytea('wallet_enc').notNull(),
  walletHash: text('wallet_hash').notNull(),
  walletLast4: text('wallet_last4').notNull(),
  status: text('status', { enum: ['active', 'replaced'] }).notNull().default('active'),
  createdAt: createdAt(),
}, (t) => [index('payout_destinations_wallet_hash').on(t.walletHash)]);

export const payoutChanges = pgTable('payout_changes', {
  id: id(),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  fromDestinationId: uuid('from_destination_id').references(() => payoutDestinations.id),
  toDestinationId: uuid('to_destination_id').notNull().references(() => payoutDestinations.id),
  status: text('status', { enum: ['pending_officer', 'cooling_off', 'objected', 'approved', 'rejected'] }).notNull().default('pending_officer'),
  requestedBy: text('requested_by').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  coolingOffUntil: ts('cooling_off_until'),
  objectedAt: ts('objected_at'),
  createdAt: createdAt(),
});

export const payments = pgTable('payments', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  destinationId: uuid('destination_id').references(() => payoutDestinations.id),
  amount: integer('amount').notNull(),
  status: text('status', { enum: ['scheduled', 'hold', 'sent', 'confirmed_full', 'disputed', 'cancelled'] }).notNull().default('scheduled'),
  holdUntil: ts('hold_until'),
  ledgerRef: text('ledger_ref'),
  sentAt: ts('sent_at'),
  confirmedAmount: integer('confirmed_amount'),
  confirmedAt: ts('confirmed_at'),
  createdAt: createdAt(),
}, (t) => [
  check('payments_amount_positive', sql`${t.amount} > 0`),
  index('payments_status_hold').on(t.status, t.holdUntil),
]);

export const complaints = pgTable('complaints', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  caseId: uuid('case_id').references(() => cases.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  citizenId: uuid('citizen_id').references(() => citizens.id),
  type: text('type', { enum: ['deduction', 'misconduct', 'scam', 'data_issue', 'payout_objection', 'other'] }).notNull(),
  amountMissing: integer('amount_missing'),
  helperUserId: uuid('helper_user_id').references(() => users.id),
  channel: text('channel').notNull(),
  description: text('description'),
  payoutChangeId: uuid('payout_change_id').references(() => payoutChanges.id),
  externalRef: text('external_ref'),
  status: text('status', { enum: ['open', 'in_review', 'resolved'] }).notNull().default('open'),
  severity: integer('severity').notNull().default(2),
  resolution: text('resolution', { enum: ['upheld', 'not_upheld', 'referred'] }),
  reasonCode: text('reason_code'),
  note: text('note'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: ts('resolved_at'),
  createdAt: createdAt(),
}, (t) => [check('complaints_amount_missing_positive', sql`${t.amountMissing} is null or ${t.amountMissing} > 0`)]);
