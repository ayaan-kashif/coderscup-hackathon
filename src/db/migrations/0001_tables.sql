CREATE SCHEMA "mock";
--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('officer', 'admin', 'auditor', 'helper');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('draft', 'submitted', 'processing', 'needs_proof', 'in_review', 'approved_on_hold', 'approved', 'rejected', 'paid', 'confirmed', 'disputed', 'paused_for_consent', 'frozen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."fact_source" AS ENUM('registry', 'qr_signed', 'officer', 'ocr', 'voice', 'self_declared');--> statement-breakpoint
CREATE TYPE "public"."match_zone" AS ENUM('match', 'review', 'non_match');--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"province" text NOT NULL,
	"tenant_id" uuid,
	"lat" double precision,
	"lng" double precision,
	CONSTRAINT "districts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"limits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"plan_id" uuid,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "citizens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"cnic_enc" "bytea" NOT NULL,
	"cnic_hash" text NOT NULL,
	"cnic_last4" text NOT NULL,
	"name_display" text NOT NULL,
	"name_norm" text NOT NULL,
	"dob" date,
	"gender" text,
	"district_id" uuid,
	"trust_picture_id" integer,
	"avatar_id" integer,
	"pin_hash" text,
	"pin_failed_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "citizens_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "citizens_cnic_hash_unique" UNIQUE("cnic_hash"),
	CONSTRAINT "citizens_trust_picture_range" CHECK ("citizens"."trust_picture_id" is null or "citizens"."trust_picture_id" between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"is_senior" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_tenant" UNIQUE("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"phone" text,
	"display_name" text NOT NULL,
	"password_hash" text,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"locale" text DEFAULT 'ur' NOT NULL,
	"sessions_revoked_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_login_present" CHECK ("users"."email" is not null or "users"."phone" is not null),
	CONSTRAINT "users_email_test_domain" CHECK ("users"."email" is null or "users"."email" like '%.test')
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"rate_per_minute" integer DEFAULT 60 NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "helper_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"citizen_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helper_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"citizen_id" uuid NOT NULL,
	"scope" text[] NOT NULL,
	"method" text NOT NULL,
	"device_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"clause_id" text NOT NULL,
	"heading" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', heading || ' ' || text)) STORED,
	CONSTRAINT "policy_chunks_doc_clause" UNIQUE("document_id","clause_id")
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_documents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"benefit_amount" integer NOT NULL,
	"frequency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"active_rule_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_tenant_code" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rules" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"costs" jsonb NOT NULL,
	"json_hash" text NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"second_approver" uuid,
	"twin_run_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_sets_program_version" UNIQUE("program_id","version")
);
--> statement-breakpoint
CREATE TABLE "case_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"source" "fact_source" NOT NULL,
	"source_ref" text,
	"superseded_by" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"citizen_id" uuid,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"route" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_officer_id" uuid,
	"escalated_to" uuid,
	"current_decision_id" uuid,
	"client_submission_id" text NOT NULL,
	"channel" text NOT NULL,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"frozen_reason" text,
	"close_reason" text,
	"submitted_at" timestamp with time zone,
	"first_opened_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_tenant_client_submission" UNIQUE("tenant_id","client_submission_id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"previous_decision_id" uuid,
	"outcome" text NOT NULL,
	"proposed_action" text NOT NULL,
	"p_legit" double precision,
	"threshold" double precision,
	"gates" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule_set_id" uuid,
	"scorer_version" text,
	"model_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"rule_trace" jsonb NOT NULL,
	"explanation_citizen" jsonb,
	"explanation_auditor" jsonb,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason_code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_officer_reject_reason" CHECK (not ("decisions"."actor_type" = 'officer' and "decisions"."outcome" = 'REJECTED' and "decisions"."reason_code" is null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sharpness" double precision,
	"dhash" bigint,
	"qr_payload" jsonb,
	"qr_sig_valid" boolean,
	"extraction" jsonb,
	"injection_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_case_storage_key" UNIQUE("case_id","storage_key")
);
--> statement-breakpoint
CREATE TABLE "identity_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"registry_record_id" text NOT NULL,
	"score_bits" double precision NOT NULL,
	"probability" double precision NOT NULL,
	"field_agreements" jsonb NOT NULL,
	"zone" "match_zone" NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item" text NOT NULL,
	"reason_code" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_requests_attempts_max" CHECK ("proof_requests"."attempts" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "voice_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"storage_key" text,
	"transcript" text,
	"stt_model" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid,
	"payment_id" uuid,
	"citizen_id" uuid,
	"type" text NOT NULL,
	"amount_missing" integer,
	"helper_user_id" uuid,
	"channel" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" integer DEFAULT 2 NOT NULL,
	"resolution" text,
	"reason_code" text,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_amount_missing_positive" CHECK ("complaints"."amount_missing" is null or "complaints"."amount_missing" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"destination_id" uuid,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"hold_until" timestamp with time zone,
	"ledger_ref" text,
	"sent_at" timestamp with time zone,
	"confirmed_amount" integer,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payout_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citizen_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_destination_id" uuid,
	"to_destination_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_officer' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" uuid,
	"cooling_off_until" timestamp with time zone,
	"objected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citizen_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'wallet' NOT NULL,
	"provider" text NOT NULL,
	"wallet_enc" "bytea" NOT NULL,
	"wallet_hash" text NOT NULL,
	"wallet_last4" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citizen_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grantee_type" text NOT NULL,
	"grantee_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"data_categories" text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"method" text NOT NULL,
	"notice_version" text NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citizen_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid,
	"field_key" text NOT NULL,
	"claimed_value" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scam_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"district_id" uuid NOT NULL,
	"scam_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scam_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"district_id" uuid,
	"reporter_user_id" uuid,
	"message_hash" text NOT NULL,
	"message_text" text,
	"channel" text NOT NULL,
	"verdict" text NOT NULL,
	"scam_type" text,
	"extracted_claims" jsonb NOT NULL,
	"ledger_check" jsonb,
	"probabilities" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"citizen_id" uuid,
	"user_id" uuid,
	"channel" text NOT NULL,
	"template_key" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" "bytea" NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"head_hash" "bytea" NOT NULL,
	"verified_ok" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("actor","key")
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"case_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"cost_usd" numeric(12, 6),
	"status" text NOT NULL,
	"error" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"probabilities" jsonb,
	"result" jsonb NOT NULL,
	"user_reason" text NOT NULL,
	"trace" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"artifact_hash" text NOT NULL,
	"metrics" jsonb,
	"ece" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_kind_version" UNIQUE("kind","version")
);
--> statement-breakpoint
CREATE TABLE "eval_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"case_ref" text NOT NULL,
	"attack_no" integer,
	"expected" jsonb NOT NULL,
	"actual" jsonb,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "twin_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twin_run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"old_outcome" text NOT NULL,
	"new_outcome" text NOT NULL,
	"direction" text NOT NULL,
	"in_flight" boolean NOT NULL,
	"harm" boolean NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "twin_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"draft_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chaos_settings" (
	"service" text PRIMARY KEY NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"timeout_rate" double precision DEFAULT 0 NOT NULL,
	"error_rate" double precision DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chaos_latency_range" CHECK ("chaos_settings"."latency_ms" between 0 and 30000),
	CONSTRAINT "chaos_timeout_rate_range" CHECK ("chaos_settings"."timeout_rate" between 0 and 1),
	CONSTRAINT "chaos_error_rate_range" CHECK ("chaos_settings"."error_rate" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"tenant_id" uuid,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_key_tenant" UNIQUE NULLS NOT DISTINCT("key","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "mock"."civil_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"certificate_no" text NOT NULL,
	"subject_cnic" text NOT NULL,
	"subject_name" text NOT NULL,
	"spouse_cnic" text,
	"spouse_name" text,
	"event_date" date NOT NULL,
	"district_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "civil_events_certificate_no_unique" UNIQUE("certificate_no")
);
--> statement-breakpoint
CREATE TABLE "mock"."complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "mock"."identity_records" (
	"id" text PRIMARY KEY NOT NULL,
	"cnic" text NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"relation_name" text,
	"relation" text,
	"dob" date,
	"gender" text NOT NULL,
	"district_code" text NOT NULL,
	"card_issued" date,
	"card_expiry" date,
	"status" text DEFAULT 'active' NOT NULL,
	"planted" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock"."issuer_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"algorithm" text DEFAULT 'Ed25519' NOT NULL,
	"public_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock"."ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"wallet_no" text NOT NULL,
	"recipient_cnic" text NOT NULL,
	"program_code" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_ref_unique" UNIQUE("ref"),
	CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mock"."sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_phone" text NOT NULL,
	"from_sender" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock"."wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_no" text NOT NULL,
	"provider" text NOT NULL,
	"holder_cnic" text NOT NULL,
	"holder_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_wallet_no_unique" UNIQUE("wallet_no")
);
--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizens" ADD CONSTRAINT "citizens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citizens" ADD CONSTRAINT "citizens_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_assignments" ADD CONSTRAINT "helper_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_assignments" ADD CONSTRAINT "helper_assignments_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_assignments" ADD CONSTRAINT "helper_assignments_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_assignments" ADD CONSTRAINT "helper_assignments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_grants" ADD CONSTRAINT "helper_grants_assignment_id_helper_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."helper_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_grants" ADD CONSTRAINT "helper_grants_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_grants" ADD CONSTRAINT "helper_grants_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_document_id_policy_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."policy_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_second_approver_users_id_fk" FOREIGN KEY ("second_approver") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_officer_id_users_id_fk" FOREIGN KEY ("assigned_officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_escalated_to_users_id_fk" FOREIGN KEY ("escalated_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_matches" ADD CONSTRAINT "identity_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_requests" ADD CONSTRAINT "proof_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD CONSTRAINT "voice_inputs_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD CONSTRAINT "voice_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_changes" ADD CONSTRAINT "payout_changes_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_changes" ADD CONSTRAINT "payout_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_changes" ADD CONSTRAINT "payout_changes_from_destination_id_payout_destinations_id_fk" FOREIGN KEY ("from_destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_changes" ADD CONSTRAINT "payout_changes_to_destination_id_payout_destinations_id_fk" FOREIGN KEY ("to_destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_changes" ADD CONSTRAINT "payout_changes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_alerts" ADD CONSTRAINT "scam_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_alerts" ADD CONSTRAINT "scam_alerts_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_alerts" ADD CONSTRAINT "scam_alerts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD CONSTRAINT "scam_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD CONSTRAINT "scam_reports_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD CONSTRAINT "scam_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_case_results" ADD CONSTRAINT "twin_case_results_twin_run_id_twin_runs_id_fk" FOREIGN KEY ("twin_run_id") REFERENCES "public"."twin_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_case_results" ADD CONSTRAINT "twin_case_results_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_runs" ADD CONSTRAINT "twin_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_runs" ADD CONSTRAINT "twin_runs_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twin_runs" ADD CONSTRAINT "twin_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chaos_settings" ADD CONSTRAINT "chaos_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citizens_name_norm_trgm" ON "citizens" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "helper_assignments_helper" ON "helper_assignments" USING btree ("helper_user_id","status");--> statement-breakpoint
CREATE INDEX "helper_grants_live" ON "helper_grants" USING btree ("helper_user_id","citizen_id");--> statement-breakpoint
CREATE INDEX "policy_chunks_embedding_hnsw" ON "policy_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "policy_chunks_tsv_gin" ON "policy_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "case_facts_case_key" ON "case_facts" USING btree ("case_id","key");--> statement-breakpoint
CREATE INDEX "cases_queue" ON "cases" USING btree ("tenant_id","status","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
CREATE INDEX "cases_citizen" ON "cases" USING btree ("citizen_id");--> statement-breakpoint
CREATE INDEX "decisions_case" ON "decisions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_dhash" ON "documents" USING btree ("dhash");--> statement-breakpoint
CREATE INDEX "payments_status_hold" ON "payments" USING btree ("status","hold_until");--> statement-breakpoint
CREATE INDEX "payout_destinations_wallet_hash" ON "payout_destinations" USING btree ("wallet_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_one_active" ON "consents" USING btree ("citizen_id","grantee_type","grantee_id","purpose") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "consents_lookup" ON "consents" USING btree ("citizen_id","grantee_id","purpose");--> statement-breakpoint
CREATE INDEX "scam_reports_district_time" ON "scam_reports" USING btree ("district_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ai_decisions_kind_time" ON "ai_decisions" USING btree ("kind","created_at");