ALTER TYPE "public"."membership_role" ADD VALUE 'shopkeeper';--> statement-breakpoint
CREATE TABLE "shop_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"shop_name" text NOT NULL,
	"district_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_login_present";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD COLUMN "reasons" jsonb;--> statement-breakpoint
ALTER TABLE "scam_reports" ADD COLUMN "reported" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_profiles" ADD CONSTRAINT "shop_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_profiles" ADD CONSTRAINT "shop_profiles_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_present" CHECK ("users"."email" is not null or "users"."phone" is not null or "users"."phone_hash" is not null or "users"."username" is not null);--> statement-breakpoint
ALTER TABLE "shop_profiles" ENABLE ROW LEVEL SECURITY;
