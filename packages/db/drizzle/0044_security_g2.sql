-- Security slice G2 (audit 2026-10-07: GK-6, GK-13, GK-16, GK-19 data side). Additive;
-- the CHECK rules are added NOT VALID and validated afterwards, so no long lock on a big table.

-- Wallet: one sale credit per order, every entry can carry a unique reference (refund/payout ids),
-- and a seller can owe the platform after a refund that exceeds the balance (never absorbed at ₱0).
ALTER TABLE "wallet_ledger_entries" ADD COLUMN IF NOT EXISTS "reference" varchar(120);
--> statement-breakpoint
DROP INDEX IF EXISTS "wallet_ledger_order_sale_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_one_sale_credit_idx" ON "wallet_ledger_entries" ("order_id") WHERE "type" = 'sale_credit';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_reference_idx" ON "wallet_ledger_entries" ("reference") WHERE "reference" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_wallets" ADD COLUMN IF NOT EXISTS "owed_balance" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_wallets" DROP CONSTRAINT IF EXISTS "tenant_wallets_non_negative";
--> statement-breakpoint
ALTER TABLE "tenant_wallets" ADD CONSTRAINT "tenant_wallets_non_negative"
  CHECK ("available_balance" >= 0 AND "pending_balance" >= 0 AND "total_withdrawn" >= 0 AND "owed_balance" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tenant_wallets" VALIDATE CONSTRAINT "tenant_wallets_non_negative";
--> statement-breakpoint
-- Payouts are claimed exactly once by whichever job gets there first.
ALTER TABLE "tenant_payouts" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenant_payouts" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Gateway refunds are recorded first and sent after commit, one row per refund, so a rolled-back
-- transaction or a retried request can never pay the buyer twice (GK-13).
CREATE TABLE IF NOT EXISTS "gateway_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "return_id" uuid REFERENCES "order_returns"("id") ON DELETE SET NULL,
  "kind" varchar(8) NOT NULL,
  "gateway" "payment_gateway" NOT NULL,
  "gateway_payment_id" varchar(255) NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "gateway_refund_id" varchar(255),
  "error" varchar(300),
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "gateway_refunds_kind_check" CHECK ("kind" IN ('full', 'partial', 'edit')),
  CONSTRAINT "gateway_refunds_status_check" CHECK ("status" IN ('pending', 'processing', 'sent', 'failed')),
  CONSTRAINT "gateway_refunds_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_refunds_one_full_idx" ON "gateway_refunds" ("order_id") WHERE "kind" = 'full';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_refunds_return_idx" ON "gateway_refunds" ("return_id") WHERE "return_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_refunds_order_idx" ON "gateway_refunds" ("order_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_refunds_status_idx" ON "gateway_refunds" ("status") WHERE "status" IN ('pending', 'failed');
--> statement-breakpoint
-- Nightly wallet reconciliation results (ledger sums vs. balances).
CREATE TABLE IF NOT EXISTS "wallet_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ok" boolean NOT NULL,
  "wallet_available" numeric(12, 2) NOT NULL,
  "wallet_pending" numeric(12, 2) NOT NULL,
  "wallet_owed" numeric(12, 2) NOT NULL,
  "ledger_available" numeric(12, 2) NOT NULL,
  "ledger_pending" numeric(12, 2) NOT NULL,
  "note" varchar(300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_reconciliations_tenant_idx" ON "wallet_reconciliations" ("tenant_id", "checked_at");
--> statement-breakpoint
-- Money rules (validated without a long lock).
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_refunded_within_total";
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_within_total"
  CHECK ("refunded_amount" IS NULL OR "refunded_amount" <= "total" + 0.01) NOT VALID;
--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_refunded_within_total";
--> statement-breakpoint
ALTER TABLE "payment_transactions" DROP CONSTRAINT IF EXISTS "payment_transactions_amount_non_negative";
--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_amount_non_negative" CHECK ("amount" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "payment_transactions" VALIDATE CONSTRAINT "payment_transactions_amount_non_negative";
--> statement-breakpoint
ALTER TABLE "order_returns" DROP CONSTRAINT IF EXISTS "order_returns_amounts_non_negative";
--> statement-breakpoint
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_amounts_non_negative" CHECK ("refund_amount" >= 0 AND "collected_amount" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "order_returns" VALIDATE CONSTRAINT "order_returns_amounts_non_negative";
