-- Phase 21: two-step sign-in (authenticator app codes + backup codes).
-- Required for ops super-admins, optional for sellers, staff and partners. Additive only.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret_sealed" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last_step" bigint;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;
