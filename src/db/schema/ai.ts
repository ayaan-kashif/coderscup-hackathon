import { doublePrecision, index, integer, jsonb, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_types';
import { tenants } from './tenancy';

/** OBS-3: every model call with model, prompt version, tokens, latency and cost. */
export const aiCalls = pgTable('ai_calls', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  caseId: uuid('case_id'),
  purpose: text('purpose').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  status: text('status', { enum: ['ok', 'error', 'timeout', 'invalid_output'] }).notNull(),
  error: text('error'),
  requestId: text('request_id'),
  createdAt: createdAt(),
});

/** EXP-5: AI decisions outside the case decision (scam verdicts, routing, triage, policy answers). */
export const aiDecisions = pgTable('ai_decisions', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  kind: text('kind', { enum: ['scam_verdict', 'intent_routing', 'complaint_triage', 'policy_answer', 'second_opinion', 'rule_draft'] }).notNull(),
  inputHash: text('input_hash').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version'),
  probabilities: jsonb('probabilities'),
  result: jsonb('result').notNull(),
  userReason: text('user_reason').notNull(),
  trace: jsonb('trace'),
  createdAt: createdAt(),
}, (t) => [index('ai_decisions_kind_time').on(t.kind, t.createdAt)]);

/** Every trained artifact: scorer weights, matcher weights, prompt versions. */
export const modelVersions = pgTable('model_versions', {
  id: id(),
  kind: text('kind', { enum: ['scorer', 'matcher', 'prompt', 'llm'] }).notNull(),
  version: text('version').notNull(),
  artifact: jsonb('artifact').notNull(),
  artifactHash: text('artifact_hash').notNull(),
  metrics: jsonb('metrics'),
  ece: doublePrecision('ece'),
  createdAt: createdAt(),
}, (t) => [unique('model_versions_kind_version').on(t.kind, t.version)]);
