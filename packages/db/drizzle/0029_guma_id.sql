-- Phase 12: Guma ID — buyers verify their mobile once and are recognised at every
-- Guma Kart checkout. Additive only. Shops never read this table directly: a shop only
-- sees what the buyer puts on that shop's order.
CREATE TABLE IF NOT EXISTS "buyer_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" varchar(11) NOT NULL,
  "name" varchar(120),
  "email" varchar(255),
  "preferred_payment" varchar(20),
  "session_version" integer DEFAULT 0 NOT NULL,
  "terms_accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone,
  CONSTRAINT "buyer_accounts_phone_check" CHECK ("phone" ~ '^09[0-9]{9}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_accounts_phone_idx" ON "buyer_accounts" ("phone");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buyer_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "buyer_id" uuid NOT NULL REFERENCES "buyer_accounts"("id") ON DELETE CASCADE,
  "label" varchar(40),
  "recipient" varchar(120),
  "address_json" jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_addresses_buyer_idx" ON "buyer_addresses" ("buyer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buyer_otp_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" varchar(11) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "ip" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_otp_codes_phone_idx" ON "buyer_otp_codes" ("phone", "created_at");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_account_id" uuid REFERENCES "buyer_accounts"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_buyer_account_idx" ON "orders" ("buyer_account_id") WHERE "buyer_account_id" IS NOT NULL;
