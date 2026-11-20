import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { citizens, users } from './people';
import { tenants } from './tenancy';

/** Which helper may assist which family; a trigger caps active assignments at 40 per helper. */
export const helperAssignments = pgTable('helper_assignments', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  helperUserId: uuid('helper_user_id').notNull().references(() => users.id),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  status: text('status', { enum: ['pending', 'active', 'revoked', 'expired'] }).notNull().default('pending'),
  approvedBy: uuid('approved_by').references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [index('helper_assignments_helper').on(t.helperUserId, t.status)]);

/** One family's time-limited unlock on the helper's phone (2 h max, 30 min idle). */
export const helperGrants = pgTable('helper_grants', {
  id: id(),
  assignmentId: uuid('assignment_id').notNull().references(() => helperAssignments.id),
  helperUserId: uuid('helper_user_id').notNull().references(() => users.id),
  citizenId: uuid('citizen_id').notNull().references(() => citizens.id),
  scope: text('scope').array().notNull(),
  method: text('method', { enum: ['pin', 'otp'] }).notNull(),
  deviceId: text('device_id'),
  expiresAt: ts('expires_at').notNull(),
  lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [index('helper_grants_live').on(t.helperUserId, t.citizenId)]);
