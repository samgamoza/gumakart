-- Phase 13: channels. Sales channel attribution on orders, Messenger/Instagram inbox
-- (ready to hook up), Shopee/Lazada listings + order import (ready to hook up). Additive only.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sales_channel" varchar(20);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "external_order_id" varchar(80);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_tenant_sales_channel_idx" ON "orders" ("tenant_id", "sales_channel", "created_at");
--> statement-breakpoint
-- Best-effort backfill: POS, then click ids, then the channel the seller shared the link to.
UPDATE "orders" SET "sales_channel" = CASE
    WHEN "source_channel" = 'pos' THEN 'pos'
    WHEN "utm_json" ? 'ttclid' THEN 'tiktok'
    WHEN "utm_json" ? 'igshid' THEN 'instagram'
    WHEN "utm_json" ? 'fbclid' THEN 'facebook'
    ELSE 'direct' END
  WHERE "sales_channel" IS NULL;
--> statement-breakpoint
UPDATE "orders" o SET "sales_channel" = l."share_channel"
  FROM "checkout_links" l
  WHERE o."checkout_link_id" = l."id" AND o."sales_channel" = 'direct'
    AND l."share_channel" IN ('facebook', 'instagram', 'tiktok', 'messenger');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "platform" varchar(16) NOT NULL,
  "external_id" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "page_id" varchar(64),
  "access_token_sealed" text,
  "status" varchar(16) DEFAULT 'connected' NOT NULL,
  "last_error" varchar(300),
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_accounts_platform_check" CHECK ("platform" IN ('messenger', 'instagram')),
  CONSTRAINT "social_accounts_status_check" CHECK ("status" IN ('connected', 'mock', 'error', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_external_idx" ON "social_accounts" ("platform", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_accounts_tenant_idx" ON "social_accounts" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "social_accounts"("id") ON DELETE CASCADE,
  "platform" varchar(16) NOT NULL,
  "external_user_id" varchar(64) NOT NULL,
  "buyer_name" varchar(160),
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "last_inbound_at" timestamp with time zone,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_preview" varchar(200),
  "unread" integer DEFAULT 0 NOT NULL,
  "status" varchar(12) DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_threads_status_check" CHECK ("status" IN ('open', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_threads_user_idx" ON "social_threads" ("account_id", "external_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_threads_inbox_idx" ON "social_threads" ("tenant_id", "status", "last_message_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL REFERENCES "social_threads"("id") ON DELETE CASCADE,
  "direction" varchar(4) NOT NULL,
  "kind" varchar(12) DEFAULT 'text' NOT NULL,
  "body" text NOT NULL,
  "payload_json" jsonb,
  "external_message_id" varchar(160),
  "status" varchar(12) DEFAULT 'sent' NOT NULL,
  "error" varchar(300),
  "sent_by_name" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "social_messages_direction_check" CHECK ("direction" IN ('in', 'out')),
  CONSTRAINT "social_messages_status_check" CHECK ("status" IN ('received', 'sent', 'mock', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_messages_external_idx" ON "social_messages" ("thread_id", "external_message_id") WHERE "external_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_messages_thread_idx" ON "social_messages" ("thread_id", "created_at");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "social_thread_id" uuid REFERENCES "social_threads"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "platform" varchar(12) NOT NULL,
  "shop_external_id" varchar(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "region" varchar(4) DEFAULT 'PH' NOT NULL,
  "tokens_sealed" text,
  "token_expires_at" timestamp with time zone,
  "status" varchar(16) DEFAULT 'connected' NOT NULL,
  "sync_stock" boolean DEFAULT true NOT NULL,
  "import_orders" boolean DEFAULT true NOT NULL,
  "last_stock_push_at" timestamp with time zone,
  "last_order_pull_at" timestamp with time zone,
  "orders_cursor_at" timestamp with time zone,
  "last_error" varchar(300),
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketplace_accounts_platform_check" CHECK ("platform" IN ('shopee', 'lazada')),
  CONSTRAINT "marketplace_accounts_status_check" CHECK ("status" IN ('connected', 'mock', 'error', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_accounts_external_idx" ON "marketplace_accounts" ("platform", "shop_external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_accounts_tenant_idx" ON "marketplace_accounts" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketplace_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "marketplace_accounts"("id") ON DELETE CASCADE,
  "external_item_id" varchar(64) NOT NULL,
  "external_model_id" varchar(64) DEFAULT '' NOT NULL,
  "external_sku" varchar(120),
  "title" varchar(300) NOT NULL,
  "price" numeric(12, 2),
  "external_stock" integer,
  "variant_id" uuid REFERENCES "product_variants"("id") ON DELETE SET NULL,
  "last_pushed_qty" integer,
  "last_pushed_at" timestamp with time zone,
  "push_error" varchar(300),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_listings_external_idx" ON "marketplace_listings" ("account_id", "external_item_id", "external_model_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_listings_variant_idx" ON "marketplace_listings" ("variant_id") WHERE "variant_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_external_order_idx" ON "orders" ("tenant_id", "sales_channel", "external_order_id") WHERE "external_order_id" IS NOT NULL;
