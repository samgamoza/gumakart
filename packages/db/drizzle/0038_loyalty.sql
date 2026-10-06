-- Phase 27: Suki loyalty points (one ledger; balance = sum of points). Rules live in
-- tenants.settings_json.loyalty. Additive only.
CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  -- earn: points for a paid order · reverse: the change after a refund/cancel (kept current)
  -- redeem: converted to store credit (negative) · adjust: seller correction
  "kind" varchar(8) NOT NULL,
  "points" integer NOT NULL,
  "tier" varchar(10),
  "earn_amount" numeric(12, 2),
  "gift_card_id" uuid REFERENCES "gift_cards"("id") ON DELETE SET NULL,
  "note" varchar(200),
  "actor_name" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_ledger_kind_chk" CHECK ("kind" IN ('earn', 'reverse', 'redeem', 'adjust'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_ledger_order_kind_idx" ON "loyalty_ledger" ("order_id", "kind") WHERE "order_id" IS NOT NULL AND "kind" IN ('earn', 'reverse');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_customer_idx" ON "loyalty_ledger" ("tenant_id", "customer_id");
