/**
 * SIMULATED government, payment and telecom systems. They live in their own `mock` schema so
 * simulated data can never be confused with platform data (PRD §20).
 */
import { date, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const mock = pgSchema('mock');

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** NADRA-like identity registry. CNICs use the never-issued locality prefix 00000. */
export const mockIdentityRecords = mock.table('identity_records', {
  id: text('id').primaryKey(),
  cnic: text('cnic').notNull(),
  name: text('name').notNull(),
  nameUr: text('name_ur'),
  relationName: text('relation_name'),
  relation: text('relation', { enum: ['father', 'husband'] }),
  dob: date('dob'),
  gender: text('gender', { enum: ['F', 'M'] }).notNull(),
  districtCode: text('district_code').notNull(),
  cardIssued: date('card_issued'),
  cardExpiry: date('card_expiry'),
  status: text('status', { enum: ['active', 'deceased'] }).notNull().default('active'),
  planted: text('planted').array().notNull().default([]),
  createdAt: created(),
});

/** Death and marriage events. */
export const mockCivilEvents = mock.table('civil_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type', { enum: ['death', 'marriage'] }).notNull(),
  certificateNo: text('certificate_no').notNull().unique(),
  subjectCnic: text('subject_cnic').notNull(),
  subjectName: text('subject_name').notNull(),
  spouseCnic: text('spouse_cnic'),
  spouseName: text('spouse_name'),
  eventDate: date('event_date').notNull(),
  districtCode: text('district_code').notNull(),
  createdAt: created(),
});

/** Raast-like wallets. */
export const mockWallets = mock.table('wallets', {
  id: text('id').primaryKey(),
  walletNo: text('wallet_no').notNull().unique(),
  provider: text('provider').notNull(),
  holderCnic: text('holder_cnic').notNull(),
  holderName: text('holder_name').notNull(),
  createdAt: created(),
});

/** Records payments; never moves money. */
export const mockLedgerTransactions = mock.table('ledger_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: text('ref').notNull().unique(),
  walletNo: text('wallet_no').notNull(),
  recipientCnic: text('recipient_cnic').notNull(),
  programCode: text('program_code').notNull(),
  amount: integer('amount').notNull(),
  status: text('status', { enum: ['sent', 'failed', 'reversed'] }).notNull().default('sent'),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: created(),
});

/** The on-screen mock phone. Nothing here is ever delivered to a real number. */
export const mockSmsMessages = mock.table('sms_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  toPhone: text('to_phone').notNull(),
  fromSender: text('from_sender').notNull(),
  body: text('body').notNull(),
  kind: text('kind', { enum: ['otp', 'notification', 'ivr', 'other'] }).notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: created(),
});

export const mockComplaints = mock.table('complaints', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: text('ref').notNull().unique(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('received'),
  createdAt: created(),
});

/** Public keys of the mock document issuer, for signed-QR verification. */
export const mockIssuerKeys = mock.table('issuer_keys', {
  kid: text('kid').primaryKey(),
  algorithm: text('algorithm').notNull().default('Ed25519'),
  /** raw 32-byte public key, base64url */
  publicKey: text('public_key').notNull(),
  status: text('status', { enum: ['active', 'retired'] }).notNull().default('active'),
  createdAt: created(),
});
