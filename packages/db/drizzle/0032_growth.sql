-- Phase 14: reports and growth. Cost prices (for profit and stock value), a cost snapshot on
-- each sold line, and SMS campaigns (consent-only). Additive only.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "cost_price" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(12, 2);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "segment_json" jsonb NOT NULL,
  "body" varchar(480) NOT NULL,
  "status" varchar(12) DEFAULT 'draft' NOT NULL,
  "scheduled_at" timestamp with time zone,
  "recipients" integer DEFAULT 0 NOT NULL,
  "sent" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "suppressed" integer DEFAULT 0 NOT NULL,
  "created_by_name" varchar(80) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  CONSTRAINT "sms_campaigns_status_check" CHECK ("status" IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_campaigns_tenant_idx" ON "sms_campaigns" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_campaigns_due_idx" ON "sms_campaigns" ("status", "scheduled_at") WHERE "status" IN ('scheduled', 'sending');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_campaign_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "sms_campaigns"("id") ON DELETE CASCADE,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "phone" varchar(20) NOT NULL,
  "name" varchar(255),
  "status" varchar(12) DEFAULT 'queued' NOT NULL,
  "error" varchar(300),
  "sent_at" timestamp with time zone,
  CONSTRAINT "sms_campaign_recipients_status_check" CHECK ("status" IN ('queued', 'sent', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_campaign_recipients_phone_idx" ON "sms_campaign_recipients" ("campaign_id", "phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_queue_idx" ON "sms_campaign_recipients" ("campaign_id", "status");
