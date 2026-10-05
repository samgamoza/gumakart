-- Phase 9: product options & variants (sizes / colours / flavours). Additive only.
-- A product without options keeps exactly one "Default" variant (as before).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "options_json" jsonb;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "compare_at_price" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "barcode" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_sku_idx" ON "product_variants" ("sku") WHERE "sku" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_barcode_idx" ON "product_variants" ("barcode") WHERE "barcode" IS NOT NULL;
