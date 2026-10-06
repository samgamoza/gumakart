-- Phase 17: seller polish. Gift cards & store credit (with a ledger), gift-card part of an
-- order's payment, and per-branch stock (location_stock kept in step with the variant total
-- by a trigger, so every existing stock path keeps working). Additive only.
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'transfer_out';
--> statement-breakpoint
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'transfer_in';
--> statement-breakpoint
ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'branch_count';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "code" varchar(24) NOT NULL,
  "kind" varchar(14) DEFAULT 'gift_card' NOT NULL,
  "initial_amount" numeric(12, 2) NOT NULL,
  "balance" numeric(12, 2) NOT NULL,
  "status" varchar(10) DEFAULT 'active' NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "recipient_name" varchar(120),
  "note" varchar(200),
  "expires_at" timestamp with time zone,
  "created_by_name" varchar(80) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gift_cards_kind_check" CHECK ("kind" IN ('gift_card', 'store_credit')),
  CONSTRAINT "gift_cards_status_check" CHECK ("status" IN ('active', 'disabled')),
  CONSTRAINT "gift_cards_balance_check" CHECK ("balance" >= 0 AND "initial_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_tenant_code_idx" ON "gift_cards" ("tenant_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_cards_customer_idx" ON "gift_cards" ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_card_txns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "gift_cards"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "kind" varchar(10) NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "balance_after" numeric(12, 2) NOT NULL,
  "note" varchar(200),
  "actor_name" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gift_card_txns_kind_check" CHECK ("kind" IN ('issue', 'redeem', 'restore', 'adjust'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_card_txns_card_idx" ON "gift_card_txns" ("card_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_card_txns_order_idx" ON "gift_card_txns" ("order_id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gift_card_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "branch_stock_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_stock" (
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "qty" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "location_stock_pk" PRIMARY KEY ("location_id", "variant_id"),
  CONSTRAINT "location_stock_qty_check" CHECK ("qty" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_stock_variant_idx" ON "location_stock" ("variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_stock_tenant_idx" ON "location_stock" ("tenant_id");
--> statement-breakpoint
-- Every change to a variant's total stock is applied to a branch: the one the transaction set
-- with set_config('guma.location_id', …) (POS), else the shop's default branch. A decrease takes
-- from that branch first, then from the others (largest first), so the branches always add up
-- to the total. Branch counts and transfers set guma.branch_sync = 'off' and write both sides.
CREATE OR REPLACE FUNCTION guma_branch_stock_sync() RETURNS trigger AS $$
DECLARE
  v_tenant uuid;
  v_delta integer;
  v_loc uuid;
  v_take integer;
  v_have integer;
  r record;
BEGIN
  IF coalesce(current_setting('guma.branch_sync', true), '') = 'off' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_delta := coalesce(NEW.stock_qty, 0);
  ELSE
    v_delta := coalesce(NEW.stock_qty, 0) - coalesce(OLD.stock_qty, 0);
  END IF;
  IF v_delta = 0 THEN RETURN NEW; END IF;
  SELECT p.tenant_id INTO v_tenant FROM products p JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = NEW.product_id AND t.branch_stock_enabled;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_loc := nullif(current_setting('guma.location_id', true), '')::uuid;
  EXCEPTION WHEN others THEN v_loc := NULL;
  END;
  IF v_loc IS NULL OR NOT EXISTS (SELECT 1 FROM locations WHERE id = v_loc AND tenant_id = v_tenant) THEN
    SELECT id INTO v_loc FROM locations WHERE tenant_id = v_tenant AND is_default LIMIT 1;
  END IF;
  IF v_loc IS NULL THEN RETURN NEW; END IF;
  INSERT INTO location_stock (location_id, variant_id, tenant_id, qty) VALUES (v_loc, NEW.id, v_tenant, 0)
    ON CONFLICT DO NOTHING;
  IF v_delta > 0 THEN
    UPDATE location_stock SET qty = qty + v_delta, updated_at = now() WHERE location_id = v_loc AND variant_id = NEW.id;
    RETURN NEW;
  END IF;
  v_delta := -v_delta;
  SELECT qty INTO v_have FROM location_stock WHERE location_id = v_loc AND variant_id = NEW.id FOR UPDATE;
  v_take := least(coalesce(v_have, 0), v_delta);
  IF v_take > 0 THEN
    UPDATE location_stock SET qty = qty - v_take, updated_at = now() WHERE location_id = v_loc AND variant_id = NEW.id;
    v_delta := v_delta - v_take;
  END IF;
  FOR r IN SELECT location_id, qty FROM location_stock
      WHERE variant_id = NEW.id AND location_id <> v_loc AND qty > 0 ORDER BY qty DESC FOR UPDATE LOOP
    EXIT WHEN v_delta <= 0;
    v_take := least(r.qty, v_delta);
    UPDATE location_stock SET qty = qty - v_take, updated_at = now() WHERE location_id = r.location_id AND variant_id = NEW.id;
    v_delta := v_delta - v_take;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_variants_branch_stock" ON "product_variants";
--> statement-breakpoint
CREATE TRIGGER "product_variants_branch_stock" AFTER INSERT OR UPDATE OF "stock_qty" ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION guma_branch_stock_sync();
