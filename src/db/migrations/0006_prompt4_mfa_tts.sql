CREATE TABLE "tts_cache" (
	"text_hash" text PRIMARY KEY NOT NULL,
	"lang" text NOT NULL,
	"model" text NOT NULL,
	"media_type" text NOT NULL,
	"audio" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_enc" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_step" integer;--> statement-breakpoint
ALTER TABLE "tts_cache" ENABLE ROW LEVEL SECURITY;
