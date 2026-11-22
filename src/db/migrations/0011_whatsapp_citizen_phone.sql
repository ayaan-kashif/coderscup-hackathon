ALTER TABLE "users" DROP CONSTRAINT "users_login_present";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_enc" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_hash_unique" UNIQUE("phone_hash");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_present" CHECK ("users"."email" is not null or "users"."phone" is not null or "users"."phone_hash" is not null);