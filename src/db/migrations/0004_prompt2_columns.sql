ALTER TABLE "cases" ADD COLUMN "pipeline" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content_enc" "bytea";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD COLUMN "media_type" text;--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD COLUMN "audio_enc" "bytea";--> statement-breakpoint
ALTER TABLE "voice_inputs" ADD COLUMN "audio_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "payout_change_id" uuid;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "old_value" jsonb;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD COLUMN "officer_label" text;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD COLUMN "labelled_by" uuid;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD COLUMN "labelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_payout_change_id_payout_changes_id_fk" FOREIGN KEY ("payout_change_id") REFERENCES "public"."payout_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD CONSTRAINT "scam_reports_labelled_by_users_id_fk" FOREIGN KEY ("labelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;