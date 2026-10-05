-- Phase 15: platform. API keys for a shop's own integrations, signed webhooks (events written
-- by triggers inside the same transaction as the change, so every path — checkout, POS,
-- marketplace import, order actions, refunds — emits them), and delivery attempts with retries.
-- Additive only. Triggers do nothing for shops without an active webhook endpoint.
CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "token_prefix" varchar(20) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "scopes" text[] NOT NULL,
  "created_by_name" varchar(80) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "api_tokens_scopes_check" CHECK (cardinality("scopes") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_hash_idx" ON "api_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_tenant_idx" ON "api_tokens" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "url" varchar(500) NOT NULL,
  "description" varchar(120),
  "events" text[] NOT NULL,
  "secret_sealed" varchar(300) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "disabled_reason" varchar(200),
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "created_by_name" varchar(80) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_endpoints_events_check" CHECK (cardinality("events") > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_tenant_idx" ON "webhook_endpoints" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event" varchar(40) NOT NULL,
  "entity_type" varchar(20) NOT NULL,
  "entity_id" uuid NOT NULL,
  "payload_json" jsonb,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "fanned_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_pending_idx" ON "webhook_events" ("created_at") WHERE "fanned_out_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_tenant_idx" ON "webhook_events" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_created_idx" ON "webhook_events" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "webhook_events"("id") ON DELETE CASCADE,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now(),
  "last_status_code" integer,
  "last_error" varchar(300),
  "response_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone,
  CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_unique_idx" ON "webhook_deliveries" ("endpoint_id", "event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_idx" ON "webhook_deliveries" ("next_attempt_at") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("endpoint_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guma_webhook_emit(p_tenant uuid, p_event text, p_type text, p_id uuid) RETURNS void AS $$
BEGIN
  IF p_tenant IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM "webhook_endpoints"
    WHERE "tenant_id" = p_tenant AND "active" AND (p_event = ANY("events") OR '*' = ANY("events"))
  ) THEN
    INSERT INTO "webhook_events" ("tenant_id", "event", "entity_type", "entity_id")
    VALUES (p_tenant, p_event, p_type, p_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guma_webhook_orders() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.created', 'order', NEW."id");
    IF NEW."payment_state" = 'paid' THEN
      PERFORM guma_webhook_emit(NEW."tenant_id", 'order.paid', 'order', NEW."id");
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."payment_state" IS DISTINCT FROM OLD."payment_state" AND NEW."payment_state" = 'paid' THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.paid', 'order', NEW."id");
  END IF;
  IF NEW."fulfillment_state" IS DISTINCT FROM OLD."fulfillment_state" THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.fulfillment_updated', 'order', NEW."id");
  END IF;
  IF NEW."order_state" IS DISTINCT FROM OLD."order_state" AND NEW."order_state" = 'completed' THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.completed', 'order', NEW."id");
  END IF;
  IF (NEW."order_state" IS DISTINCT FROM OLD."order_state" AND NEW."order_state" = 'cancelled')
     OR (NEW."voided_at" IS NOT NULL AND OLD."voided_at" IS NULL) THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.cancelled', 'order', NEW."id");
  END IF;
  IF NEW."refunded_amount" > OLD."refunded_amount"
     OR (NEW."payment_state" IS DISTINCT FROM OLD."payment_state" AND NEW."payment_state" IN ('refunded', 'partially_refunded')) THEN
    PERFORM guma_webhook_emit(NEW."tenant_id", 'order.refunded', 'order', NEW."id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_webhooks" ON "orders";
--> statement-breakpoint
CREATE TRIGGER "orders_webhooks" AFTER INSERT OR UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION guma_webhook_orders();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guma_webhook_variants() RETURNS trigger AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW."stock_qty" IS DISTINCT FROM OLD."stock_qty" THEN
    SELECT "tenant_id" INTO v_tenant FROM "products" WHERE "id" = NEW."product_id";
    PERFORM guma_webhook_emit(v_tenant, 'inventory.updated', 'variant', NEW."id");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_variants_webhooks" ON "product_variants";
--> statement-breakpoint
CREATE TRIGGER "product_variants_webhooks" AFTER UPDATE OF "stock_qty" ON "product_variants"
  FOR EACH ROW EXECUTE FUNCTION guma_webhook_variants();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guma_webhook_customers() RETURNS trigger AS $$
BEGIN
  PERFORM guma_webhook_emit(NEW."tenant_id", 'customer.created', 'customer', NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "customers_webhooks" ON "customers";
--> statement-breakpoint
CREATE TRIGGER "customers_webhooks" AFTER INSERT ON "customers"
  FOR EACH ROW EXECUTE FUNCTION guma_webhook_customers();
