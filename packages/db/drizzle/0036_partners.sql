-- Phase 18: agency partner program (no commission yet) + platform v1.1 product webhooks.
-- Partners have their own login (role 'partner', no shop of their own). A shop owner grants a
-- partner access by code; the grant is re-checked on every API call, so revoking is instant.
-- Referral attribution is recorded at signup for a future commission decision. Additive only.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'partner';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "code" varchar(16) NOT NULL,
  "contact_email" varchar(255) NOT NULL,
  "phone" varchar(20),
  "website" varchar(255),
  "city" varchar(120),
  "about" varchar(500),
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "status_note" varchar(300),
  "approved_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "partners_status_chk" CHECK ("status" IN ('pending', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partners_user_idx" ON "partners" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partners_code_idx" ON "partners" ("code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_shops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- 'referral' = shop signed up through the partner's link; 'grant' = owner added the partner.
  "source" varchar(10) NOT NULL,
  -- null = no dashboard access (referral only); otherwise the role the partner works as.
  "access_role" varchar(10),
  "granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "granted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_opened_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "partner_shops_source_chk" CHECK ("source" IN ('referral', 'grant')),
  CONSTRAINT "partner_shops_role_chk" CHECK ("access_role" IS NULL OR "access_role" IN ('manager', 'staff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_shops_pair_idx" ON "partner_shops" ("partner_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_shops_tenant_idx" ON "partner_shops" ("tenant_id");
--> statement-breakpoint
-- One partner with access per shop at a time keeps "who is helping us" obvious to the owner.
CREATE UNIQUE INDEX IF NOT EXISTS "partner_shops_one_active_idx" ON "partner_shops" ("tenant_id")
  WHERE "access_role" IS NOT NULL AND "revoked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "referred_by_partner_id" uuid REFERENCES "partners"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Platform v1.1: product webhooks.
CREATE OR REPLACE FUNCTION guma_webhook_products() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'product.created', 'product', NEW."id");
  ELSIF NEW."title" IS DISTINCT FROM OLD."title"
     OR NEW."base_price" IS DISTINCT FROM OLD."base_price"
     OR NEW."compare_at_price" IS DISTINCT FROM OLD."compare_at_price"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."description_html" IS DISTINCT FROM OLD."description_html"
     OR NEW."category_id" IS DISTINCT FROM OLD."category_id" THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'product.updated', 'product', NEW."id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "products_webhooks" ON "products";
--> statement-breakpoint
CREATE TRIGGER "products_webhooks" AFTER INSERT OR UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION guma_webhook_products();
