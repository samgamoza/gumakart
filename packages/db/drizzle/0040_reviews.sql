-- Phase 23: verified product reviews. One review per order item, only from a completed or delivered
-- order (checked in code). Additive only.
CREATE TABLE IF NOT EXISTS "product_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_item_id" uuid NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "rating" smallint NOT NULL,
  "body" text,
  "photos_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- Shown name, e.g. "Ana R." (never the phone or full name).
  "buyer_name" varchar(60) NOT NULL,
  -- published · hidden (by the seller, with a reason) · removed (by Guma ops after a report)
  "status" varchar(10) DEFAULT 'published' NOT NULL,
  "hidden_reason" varchar(200),
  "seller_reply" text,
  "seller_reply_at" timestamp with time zone,
  -- open · kept · removed (Guma ops decision on a seller's report)
  "report_status" varchar(10),
  "report_reason" varchar(200),
  "reported_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_reviews_rating_chk" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "product_reviews_status_chk" CHECK ("status" IN ('published', 'hidden', 'removed')),
  CONSTRAINT "product_reviews_report_chk" CHECK ("report_status" IS NULL OR "report_status" IN ('open', 'kept', 'removed')),
  CONSTRAINT "product_reviews_body_chk" CHECK ("body" IS NULL OR char_length("body") <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_reviews_item_idx" ON "product_reviews" ("order_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_reviews_product_idx" ON "product_reviews" ("tenant_id", "product_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_reviews_tenant_idx" ON "product_reviews" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_reviews_reported_idx" ON "product_reviews" ("reported_at") WHERE "report_status" = 'open';
