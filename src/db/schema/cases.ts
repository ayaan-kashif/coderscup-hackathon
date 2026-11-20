import { sql } from 'drizzle-orm';
import { bigint, boolean, check, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_types';
import { citizens, users } from './people';
import { programs, ruleSets } from './policy';
import { tenants } from './tenancy';

/** CASE-5 */
export const caseStatus = pgEnum('case_status', [
  'draft', 'submitted', 'processing', 'needs_proof', 'in_review', 'approved_on_hold', 'approved',
  'rejected', 'paid', 'confirmed', 'disputed', 'paused_for_consent', 'frozen', 'closed',
]);

/** Strongest first: registry, signed QR, officer, OCR, voice, self-declared (F6 step 1). */
export const factSource = pgEnum('fact_source', ['registry', 'qr_signed', 'officer', 'ocr', 'voice', 'self_declared']);

export const matchZone = pgEnum('match_zone', ['match', 'review', 'non_match']);

export const cases = pgTable('cases', {
  id: id(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  programId: uuid('program_id').notNull().references(() => programs.id),
  citizenId: uuid('citizen_id').references(() => citizens.id),
  status: caseStatus('status').notNull().default('draft'),
  route: text('route'),
  priority: integer('priority').notNull().default(0),
  assignedOfficerId: uuid('assigned_officer_id').references(() => users.id),
  escalatedTo: uuid('escalated_to').references(() => users.id),
  currentDecisionId: uuid('current_decision_id'),
  clientSubmissionId: text('client_submission_id').notNull(),
  channel: text('channel', { enum: ['citizen', 'helper', 'api', 'officer'] }).notNull(),
  createdByType: text('created_by_type').notNull(),
  createdById: text('created_by_id').notNull(),
  frozenReason: text('frozen_reason'),
  closeReason: text('close_reason'),
  submittedAt: ts('submitted_at'),
  firstOpenedAt: ts('first_opened_at'),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  unique('cases_tenant_client_submission').on(t.tenantId, t.clientSubmissionId),
  index('cases_queue').on(t.tenantId, t.status, t.priority.desc(), t.createdAt),
  index('cases_citizen').on(t.citizenId),
]);

export const caseFacts = pgTable('case_facts', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  key: text('key').notNull(),
  value: jsonb('value'),
  source: factSource('source').notNull(),
  sourceRef: text('source_ref'),
  supersededBy: uuid('superseded_by'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, (t) => [index('case_facts_case_key').on(t.caseId, t.key)]);

export const documents = pgTable('documents', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  docType: text('doc_type', { enum: ['cnic_front', 'cnic_back', 'death_certificate', 'other'] }).notNull(),
  /** SHA-256 of the file, so a re-upload after a drop is idempotent */
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sharpness: doublePrecision('sharpness'),
  /** 64-bit difference hash, compared by Hamming distance (5 bits or less = reuse) */
  dhash: bigint('dhash', { mode: 'bigint' }),
  qrPayload: jsonb('qr_payload'),
  qrSigValid: boolean('qr_sig_valid'),
  extraction: jsonb('extraction'),
  injectionFlag: boolean('injection_flag').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [unique('documents_case_storage_key').on(t.caseId, t.storageKey), index('documents_dhash').on(t.dhash)]);

export const voiceInputs = pgTable('voice_inputs', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  questionKey: text('question_key').notNull(),
  storageKey: text('storage_key'),
  transcript: text('transcript'),
  sttModel: text('stt_model'),
  confirmed: boolean('confirmed').notNull().default(false),
  createdAt: createdAt(),
});

export const identityMatches = pgTable('identity_matches', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  registryRecordId: text('registry_record_id').notNull(),
  scoreBits: doublePrecision('score_bits').notNull(),
  probability: doublePrecision('probability').notNull(),
  fieldAgreements: jsonb('field_agreements').notNull(),
  zone: matchZone('zone').notNull(),
  rank: integer('rank').notNull(),
  createdAt: createdAt(),
});

/** Immutable decision records (DEC-8): a trigger forbids update and delete. */
export const decisions = pgTable('decisions', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  previousDecisionId: uuid('previous_decision_id'),
  outcome: text('outcome').notNull(),
  proposedAction: text('proposed_action').notNull(),
  pLegit: doublePrecision('p_legit'),
  threshold: doublePrecision('threshold'),
  gates: text('gates').array().notNull().default(sql`'{}'::text[]`),
  ruleSetId: uuid('rule_set_id').references(() => ruleSets.id),
  scorerVersion: text('scorer_version'),
  modelVersions: jsonb('model_versions').notNull().default({}),
  promptVersions: jsonb('prompt_versions').notNull().default({}),
  inputHash: text('input_hash').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  ruleTrace: jsonb('rule_trace').notNull(),
  explanationCitizen: jsonb('explanation_citizen'),
  explanationAuditor: jsonb('explanation_auditor'),
  actorType: text('actor_type', { enum: ['system', 'officer'] }).notNull(),
  actorId: text('actor_id').notNull(),
  reasonCode: text('reason_code'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [
  index('decisions_case').on(t.caseId, t.createdAt),
  check('decisions_officer_reject_reason', sql`not (${t.actorType} = 'officer' and ${t.outcome} = 'REJECTED' and ${t.reasonCode} is null)`),
]);

export const proofRequests = pgTable('proof_requests', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  item: text('item').notNull(),
  reasonCode: text('reason_code').notNull(),
  attempts: integer('attempts').notNull().default(0),
  status: text('status', { enum: ['open', 'fulfilled', 'expired', 'cancelled'] }).notNull().default('open'),
  fulfilledAt: ts('fulfilled_at'),
  createdAt: createdAt(),
}, (t) => [check('proof_requests_attempts_max', sql`${t.attempts} between 0 and 2`)]);
