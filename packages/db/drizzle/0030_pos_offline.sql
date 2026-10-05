-- Phase 12b: POS offline mode. Sales rung while the register had no internet are queued on
-- the device and synced later (same idempotency key). Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pos_offline_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pos_device_id" varchar(40);
--> statement-breakpoint
-- BIR on: a device reserves a block of invoice numbers while online so receipts printed
-- offline still carry a real, never-reused number.
CREATE TABLE IF NOT EXISTS "pos_invoice_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "register_id" uuid NOT NULL REFERENCES "registers"("id") ON DELETE CASCADE,
  "device_id" varchar(40) NOT NULL,
  "prefix" varchar(12) DEFAULT '' NOT NULL,
  "start_no" bigint NOT NULL,
  "end_no" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "released_at" timestamp with time zone,
  "released_by_name" varchar(80),
  CONSTRAINT "pos_invoice_blocks_range_check" CHECK ("end_no" >= "start_no")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_invoice_blocks_device_idx" ON "pos_invoice_blocks" ("tenant_id", "register_id", "device_id");
--> statement-breakpoint
-- Things an offline sale needed the owner to look at (stock ran short, price changed,
-- number reassigned, landed on a closed shift, or couldn't be saved at all).
CREATE TABLE IF NOT EXISTS "pos_sync_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "kind" varchar(24) NOT NULL,
  "message" varchar(300) NOT NULL,
  "detail_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_name" varchar(80),
  CONSTRAINT "pos_sync_issues_kind_check" CHECK ("kind" IN ('stock_short', 'price_changed', 'unavailable', 'invoice_reassigned', 'closed_shift', 'after_z', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sync_issues_open_idx" ON "pos_sync_issues" ("tenant_id", "created_at") WHERE "resolved_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_sync_issues_rejected_idx" ON "pos_sync_issues" ("tenant_id", "idempotency_key") WHERE "kind" = 'rejected';
