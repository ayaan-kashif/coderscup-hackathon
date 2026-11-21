CREATE TABLE "duress_alarms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text DEFAULT 'DURESS_SILENT_ALARM' NOT NULL,
	"severity" text DEFAULT 'CRITICAL' NOT NULL,
	"citizen_id" uuid NOT NULL,
	"case_id" uuid,
	"payout_change_id" uuid,
	"trigger" text NOT NULL,
	"helper_user_id" uuid,
	"helper_grant_ids" uuid[] DEFAULT '{}' NOT NULL,
	"session" jsonb NOT NULL,
	"attempted" jsonb,
	"frozen_case_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citizens" ADD COLUMN "duress_pin_hash" text;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_citizen_id_citizens_id_fk" FOREIGN KEY ("citizen_id") REFERENCES "public"."citizens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_payout_change_id_payout_changes_id_fk" FOREIGN KEY ("payout_change_id") REFERENCES "public"."payout_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duress_alarms" ADD CONSTRAINT "duress_alarms_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duress_alarms_tenant_status" ON "duress_alarms" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
-- staff-only evidence: no policy, so browser roles (anon / authenticated) see nothing (RLS backstop)
ALTER TABLE "duress_alarms" ENABLE ROW LEVEL SECURITY;
