import { boolean, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { cases } from './cases';
import { users } from './people';
import { ruleSets } from './policy';
import { tenants } from './tenancy';

export const twinRuns = pgTable('twin_runs', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  ruleSetId: uuid('rule_set_id').notNull().references(() => ruleSets.id),
  /** TWIN-3: a run is tied to the draft's hash */
  draftHash: text('draft_hash').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
  summary: jsonb('summary'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});

export const twinCaseResults = pgTable('twin_case_results', {
  id: id(),
  twinRunId: uuid('twin_run_id').notNull().references(() => twinRuns.id, { onDelete: 'cascade' }),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  oldOutcome: text('old_outcome').notNull(),
  newOutcome: text('new_outcome').notNull(),
  direction: text('direction', { enum: ['better', 'worse', 'same'] }).notNull(),
  inFlight: boolean('in_flight').notNull(),
  harm: boolean('harm').notNull(),
  details: jsonb('details'),
});

export const evalRuns = pgTable('eval_runs', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  kind: text('kind', { enum: ['offline', 'break_it', 'cost_preview'] }).notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
  params: jsonb('params').notNull().default({}),
  metrics: jsonb('metrics'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});

export const evalCaseResults = pgTable('eval_case_results', {
  id: id(),
  evalRunId: uuid('eval_run_id').notNull().references(() => evalRuns.id, { onDelete: 'cascade' }),
  caseRef: text('case_ref').notNull(),
  attackNo: integer('attack_no'),
  expected: jsonb('expected').notNull(),
  actual: jsonb('actual'),
  result: text('result', { enum: ['caught', 'asked', 'escalated', 'false_alarm', 'missed', 'pass'] }),
  createdAt: createdAt(),
});
