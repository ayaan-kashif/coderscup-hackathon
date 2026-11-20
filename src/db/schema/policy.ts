import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid, vector } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, tsvector } from './_types';
import { users } from './people';
import { tenants } from './tenancy';

export const programs = pgTable('programs', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  nameUr: text('name_ur'),
  benefitAmount: integer('benefit_amount').notNull(),
  frequency: text('frequency').notNull(),
  active: boolean('active').notNull().default(true),
  /** pointer to the published rule set; switched atomically on publish */
  activeRuleSetId: uuid('active_rule_set_id'),
  createdAt: createdAt(),
}, (t) => [unique('programs_tenant_code').on(t.tenantId, t.code)]);

/** Versioned eligibility rules, thresholds and costs. Immutable once published. */
export const ruleSets = pgTable('rule_sets', {
  id: id(),
  programId: uuid('program_id').notNull().references(() => programs.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'published', 'retired'] }).notNull().default('draft'),
  rules: jsonb('rules').notNull(),
  thresholds: jsonb('thresholds').notNull(),
  costs: jsonb('costs').notNull(),
  jsonHash: text('json_hash').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  secondApprover: uuid('second_approver').references(() => users.id),
  twinRunId: uuid('twin_run_id'),
  publishedAt: ts('published_at'),
  createdAt: createdAt(),
}, (t) => [unique('rule_sets_program_version').on(t.programId, t.version)]);

export const policyDocuments = pgTable('policy_documents', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  version: text('version').notNull(),
  language: text('language').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

export const policyChunks = pgTable('policy_chunks', {
  id: id(),
  documentId: uuid('document_id').notNull().references(() => policyDocuments.id, { onDelete: 'cascade' }),
  clauseId: text('clause_id').notNull(),
  heading: text('heading').notNull(),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('simple', heading || ' ' || text)`),
}, (t) => [
  unique('policy_chunks_doc_clause').on(t.documentId, t.clauseId),
  index('policy_chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  index('policy_chunks_tsv_gin').using('gin', t.tsv),
]);
