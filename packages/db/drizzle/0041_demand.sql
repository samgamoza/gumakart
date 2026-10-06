-- Phase 22: buyer demand capture — back-in-stock alerts, wishlists, pre-order lines. Additive only.
CREATE TABLE IF NOT EXISTS "stock_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- The option the buyer wanted; null for a product without options (its only variant).
  "variant_id" uuid REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "phone" varchar(20),
  "email" varchar(255),
  "buyer_account_id" uuid REFERENCES "buyer_accounts"("id") ON DELETE SET NULL,
  -- waiting · notified · cancelled
  "status" varchar(10) DEFAULT 'waiting' NOT NULL,
  "notified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_alerts_status_chk" CHECK ("status" IN ('waiting', 'notified', 'cancelled')),
  CONSTRAINT "stock_alerts_contact_chk" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_alerts_waiting_idx" ON "stock_alerts" ("tenant_id", "product_id", "variant_id", "created_at") WHERE "status" = 'waiting';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_alerts_phone_idx" ON "stock_alerts" ("product_id", coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid), "phone") WHERE "status" = 'waiting' AND "phone" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_alerts_email_idx" ON "stock_alerts" ("product_id", coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("email")) WHERE "status" = 'waiting' AND "email" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wishlist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- A Guma ID buyer, or an anonymous device id (random, kept in the browser) for guests.
  "buyer_account_id" uuid REFERENCES "buyer_accounts"("id") ON DELETE CASCADE,
  "device_id" varchar(40),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wishlist_items_owner_chk" CHECK ("buyer_account_id" IS NOT NULL OR "device_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_items_buyer_idx" ON "wishlist_items" ("buyer_account_id", "product_id") WHERE "buyer_account_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_items_device_idx" ON "wishlist_items" ("device_id", "product_id") WHERE "buyer_account_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wishlist_items_tenant_idx" ON "wishlist_items" ("tenant_id", "product_id");
--> statement-breakpoint
-- Pre-order lines don't take stock; the date is the shop's expected ship date at the time of ordering.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "preorder_ship_date" date;
