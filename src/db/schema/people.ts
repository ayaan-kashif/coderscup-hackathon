import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, ts } from './_types';
import { districts, tenants } from './tenancy';

export const membershipRole = pgEnum('membership_role', ['officer', 'admin', 'auditor', 'helper']);

/** Every login: staff and helpers (email + password), citizens (phone + OTP, then PIN). */
export const users = pgTable('users', {
  id: id(),
  kind: text('kind', { enum: ['staff', 'citizen'] }).notNull(),
  email: text('email').unique(),
  phone: text('phone').unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  otpHash: text('otp_hash'),
  otpExpiresAt: ts('otp_expires_at'),
  otpAttempts: integer('otp_attempts').notNull().default(0),
  locale: text('locale').notNull().default('ur'),
  sessionsRevokedAt: ts('sessions_revoked_at'),
  /** AUTH-1 (P1): TOTP secret for admins and auditors, encrypted with the PII key; enabled once a code is confirmed */
  mfaSecretEnc: bytea('mfa_secret_enc'),
  mfaEnabledAt: ts('mfa_enabled_at'),
  mfaLastStep: integer('mfa_last_step'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
}, (t) => [
  check('users_login_present', sql`${t.email} is not null or ${t.phone} is not null`),
  // staff use the reserved .test domain only (AUTH-1)
  check('users_email_test_domain', sql`${t.email} is null or ${t.email} like '%.test'`),
]);

export const memberships = pgTable('memberships', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  role: membershipRole('role').notNull(),
  isSenior: boolean('is_senior').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [unique('memberships_user_tenant').on(t.userId, t.tenantId)]);

/** The person a case is about. Global identity (TEN-3); consent is per tenant. */
export const citizens = pgTable('citizens', {
  id: id(),
  userId: uuid('user_id').unique().references(() => users.id),
  cnicEnc: bytea('cnic_enc').notNull(),
  cnicHash: text('cnic_hash').notNull().unique(),
  cnicLast4: text('cnic_last4').notNull(),
  nameDisplay: text('name_display').notNull(),
  nameNorm: text('name_norm').notNull(),
  dob: date('dob'),
  gender: text('gender', { enum: ['F', 'M', 'X'] }),
  districtId: uuid('district_id').references(() => districts.id),
  trustPictureId: integer('trust_picture_id'),
  avatarId: integer('avatar_id'),
  pinHash: text('pin_hash'),
  /** Silent Duress PIN: hash of the reversed PIN (same Argon2id scheme). Entering it looks like a normal sign-in but locks the money down. */
  duressPinHash: text('duress_pin_hash'),
  pinFailedAttempts: integer('pin_failed_attempts').notNull().default(0),
  pinLockedUntil: ts('pin_locked_until'),
  createdAt: createdAt(),
}, (t) => [
  check('citizens_trust_picture_range', sql`${t.trustPictureId} is null or ${t.trustPictureId} between 1 and 30`),
  index('citizens_name_norm_trgm').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
]);
