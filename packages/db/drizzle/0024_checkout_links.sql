-- Phase 3: Guma Checkout Links (kart.guma.one/c/<code>).
-- Additive only: two new tables and one nullable column on orders.
CREATE TABLE IF NOT EXISTS "checkout_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code" varchar(16) NOT NULL,
  "title" varchar(120) NOT NULL,
  "share_channel" varchar(20),
  "allow_quantity_edit" boolean DEFAULT true NOT NULL,
  "delivery_mode" varchar(12) DEFAULT 'both' NOT NULL,
  "payment_methods" jsonb,
  "coupon_code" varchar(64),
  "expires_at" timestamp with time zone,
  "max_orders" integer,
  "active" boolean DEFAULT true NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "start_count" integer DEFAULT 0 NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checkout_links_delivery_mode_chk" CHECK ("delivery_mode" IN ('both', 'delivery', 'pickup')),
  CONSTRAINT "checkout_links_max_orders_chk" CHECK ("max_orders" IS NULL OR "max_orders" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_links_code_idx" ON "checkout_links" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_links_tenant_idx" ON "checkout_links" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkout_link_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id" uuid NOT NULL REFERENCES "checkout_links"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "variant_id" uuid REFERENCES "product_variants"("id") ON DELETE SET NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "checkout_link_items_qty_chk" CHECK ("quantity" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_link_items_link_idx" ON "checkout_link_items" ("link_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_link_items_product_idx" ON "checkout_link_items" ("product_id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "checkout_link_id" uuid REFERENCES "checkout_links"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_checkout_link_idx" ON "orders" ("checkout_link_id") WHERE "checkout_link_id" IS NOT NULL;
