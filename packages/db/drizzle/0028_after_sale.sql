-- Phase 11: after-sale (notes/tags, edits, returns, exchanges, partial refunds, POS voids)
-- and BIR-ready POS numbering (inactive until a shop turns it on). Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_note" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tags_json" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "invoice_number" varchar(32);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_invoice_number_idx" ON "orders" ("tenant_id", "invoice_number") WHERE "invoice_number" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "returned_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "items_json" jsonb NOT NULL,
  "refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "collected_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "refund_method" varchar(16) NOT NULL,
  "gateway_refund_id" varchar(255),
  "note" varchar(300),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_name" varchar(80) NOT NULL,
  "pos_staff_id" uuid REFERENCES "pos_staff"("id") ON DELETE SET NULL,
  "register_session_id" uuid REFERENCES "register_sessions"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_returns_kind_check" CHECK ("kind" IN ('return', 'exchange', 'void', 'edit')),
  CONSTRAINT "order_returns_amounts_check" CHECK ("refund_amount" >= 0 AND "collected_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_returns_order_idx" ON "order_returns" ("tenant_id", "order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_returns_shift_idx" ON "order_returns" ("register_session_id") WHERE "register_session_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_invoice_counters" (
  "register_id" uuid PRIMARY KEY REFERENCES "registers"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "prefix" varchar(12) DEFAULT '' NOT NULL,
  "next_invoice" bigint DEFAULT 1 NOT NULL,
  "next_z" integer DEFAULT 1 NOT NULL,
  "grand_total" numeric(16, 2) DEFAULT '0' NOT NULL,
  "last_z_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_z_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "register_id" uuid NOT NULL REFERENCES "registers"("id") ON DELETE CASCADE,
  "z_number" integer NOT NULL,
  "from_at" timestamp with time zone,
  "to_at" timestamp with time zone NOT NULL,
  "from_invoice" varchar(32),
  "to_invoice" varchar(32),
  "totals_json" jsonb NOT NULL,
  "grand_total_before" numeric(16, 2) NOT NULL,
  "grand_total_after" numeric(16, 2) NOT NULL,
  "created_by_name" varchar(80) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_z_readings_number_idx" ON "pos_z_readings" ("register_id", "z_number");
--> statement-breakpoint
-- Edits, returns and exchanges move stock on an order more than once, so they get their
-- own reasons, and the once-per-order guard stays on the original sale/restock reasons.
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'order_edit';
--> statement-breakpoint
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'return_restock';
--> statement-breakpoint
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'exchange_out';
--> statement-breakpoint
DROP INDEX IF EXISTS "stock_movements_order_variant_reason_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_order_variant_reason_idx"
  ON "stock_movements" USING btree ("order_id", "variant_id", "reason")
  WHERE "order_id" IS NOT NULL AND "reason" IN ('sale', 'restock_cancel', 'restock_refund', 'restock_expiry');
