-- Phase 5: POS Lite. Additive only: three new tables and four nullable columns on orders.
-- A POS sale is an ordinary order (source_channel = 'pos'), paid and picked up in one transaction.
CREATE TABLE IF NOT EXISTS "pos_staff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(60) NOT NULL,
  "role" varchar(16) DEFAULT 'cashier' NOT NULL,
  "pin_hash" varchar(255) NOT NULL,
  "pin_version" integer DEFAULT 1 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pos_staff_role_chk" CHECK ("role" IN ('cashier', 'manager'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_staff_tenant_name_idx" ON "pos_staff" ("tenant_id", lower("name"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "registers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "name" varchar(60) DEFAULT 'Register 1' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- V1: one register per location.
CREATE UNIQUE INDEX IF NOT EXISTS "registers_location_idx" ON "registers" ("location_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "register_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "register_id" uuid NOT NULL REFERENCES "registers"("id") ON DELETE CASCADE,
  "status" varchar(12) DEFAULT 'open' NOT NULL,
  "opening_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
  "opened_by_staff_id" uuid REFERENCES "pos_staff"("id") ON DELETE SET NULL,
  "opened_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_by_staff_id" uuid REFERENCES "pos_staff"("id") ON DELETE SET NULL,
  "closed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_at" timestamp with time zone,
  "expected_json" jsonb,
  "counted_json" jsonb,
  "variance_json" jsonb,
  "close_note" text,
  CONSTRAINT "register_sessions_status_chk" CHECK ("status" IN ('open', 'closed'))
);
--> statement-breakpoint
-- Only one open shift per register.
CREATE UNIQUE INDEX IF NOT EXISTS "register_sessions_one_open_idx" ON "register_sessions" ("register_id") WHERE "status" = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "register_sessions_tenant_idx" ON "register_sessions" ("tenant_id", "opened_at");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "register_session_id" uuid REFERENCES "register_sessions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pos_staff_id" uuid REFERENCES "pos_staff"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pos_idempotency_key" varchar(64);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pos_meta_json" jsonb;
--> statement-breakpoint
-- A retried "Charge" never makes a second sale.
CREATE UNIQUE INDEX IF NOT EXISTS "orders_pos_idempotency_idx" ON "orders" ("tenant_id", "pos_idempotency_key") WHERE "pos_idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_register_session_idx" ON "orders" ("register_session_id") WHERE "register_session_id" IS NOT NULL;
