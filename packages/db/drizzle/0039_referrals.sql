-- Phase 32: buyer referral codes ("Give ₱50, get ₱50" as store credit) — Suki loyalty add-on.
-- Additive only. Rules live in tenants.settings_json.loyalty.referral.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_referral_code_idx" ON "customers" ("tenant_id", "referral_code") WHERE "referral_code" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "referral_code" varchar(12);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "referrer_customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "friend_customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  -- rewarded: both got store credit · blocked: didn't qualify (reason says why), never retried
  "status" varchar(10) NOT NULL,
  "reason" varchar(120),
  "referrer_card_id" uuid REFERENCES "gift_cards"("id") ON DELETE SET NULL,
  "friend_card_id" uuid REFERENCES "gift_cards"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrals_status_chk" CHECK ("status" IN ('rewarded', 'blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_friend_idx" ON "referrals" ("tenant_id", "friend_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" ("tenant_id", "referrer_customer_id", "created_at");
