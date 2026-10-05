-- Phase 10: staff accounts, roles, invites and the shop activity log. Additive only.
-- Owners stay users.role = 'seller_owner'; staff are 'seller_staff' with a staff_role.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staff_role" varchar(16);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "name" varchar(80),
  "staff_role" varchar(16) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_invites_role_check" CHECK ("staff_role" IN ('manager', 'staff', 'cashier'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invites_token_idx" ON "staff_invites" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_invites_tenant_idx" ON "staff_invites" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_name" varchar(80) NOT NULL,
  "actor_role" varchar(16),
  "action" varchar(48) NOT NULL,
  "entity_type" varchar(24),
  "entity_id" varchar(64),
  "summary" varchar(300) NOT NULL,
  "meta_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_tenant_idx" ON "activity_log" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_actor_idx" ON "activity_log" ("tenant_id", "actor_user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "pos_staff" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_staff_user_idx" ON "pos_staff" ("user_id") WHERE "user_id" IS NOT NULL;
