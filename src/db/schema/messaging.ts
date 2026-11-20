import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, ts } from './_types';
import { citizens, users } from './people';
import { tenants } from './tenancy';

/** NOT-2: channels are in-app, mock SMS and voice note only. No WhatsApp, no email. */
export const notifications = pgTable('notifications', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  citizenId: uuid('citizen_id').references(() => citizens.id),
  userId: uuid('user_id').references(() => users.id),
  channel: text('channel', { enum: ['in_app', 'sms', 'voice'] }).notNull(),
  templateKey: text('template_key').notNull(),
  variables: jsonb('variables').notNull().default({}),
  status: text('status', { enum: ['queued', 'sent', 'failed', 'read'] }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: ts('sent_at'),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notifications_user').on(t.userId, t.createdAt)]);

/** Transactional outbox: written in the same transaction as the change, dispatched to jobs. */
export const outbox = pgTable('outbox', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'dispatched', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  dispatchedAt: ts('dispatched_at'),
  createdAt: createdAt(),
}, (t) => [index('outbox_pending').on(t.status, t.nextAttemptAt)]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  url: text('url').notNull(),
  secretEnc: bytea('secret_enc').notNull(),
  events: text('events').array().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: id(),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'delivered', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at'),
  responseStatus: integer('response_status'),
  createdAt: createdAt(),
});
