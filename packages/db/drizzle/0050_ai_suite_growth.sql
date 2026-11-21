-- AI Marketing Suite Phases 4 + 5 (IMPLEMENTATION_PLAN.md). Additive only.
--
-- Phase 4
--   1. broadcast_recipients — who a payday / restock broadcast goes to, frozen when it's queued,
--      with how each buyer can be reached (Messenger / IG inside the 24 h window, WhatsApp session
--      message inside 24 h, or an approved WhatsApp template), and the per-message result.
--   2. broadcast_campaigns: product (restock), WhatsApp template language, skipped count, AI-polished text.
--   3. review_prompts — one per delivered BayanGo order: asked 2 h after delivery, the buyer's
--      rating/photos, the published review ids and the thank-you voucher.
--   4. gift_cards.single_use — a voucher that is used up by its first order (the review thank-you).
--   5. ai_suite_settings — per-shop switches for the review loop and the WhatsApp templates to use.
-- Phase 5
--   6. printair_upsells — one per shop + milestone (first studio campaign, 10/50/100/500 completed
--      orders): the background printair_mockup render and whether the seller dismissed / ordered.
-- Plus checkout_links.origin gains 'reorder' (varchar, no constraint change needed).
-- Fix for Phase 3: social_accounts.platform also allows 'whatsapp' (0031's check only had
-- messenger / instagram, so connecting a WhatsApp number would have been refused).

ALTER TABLE "social_accounts" DROP CONSTRAINT IF EXISTS "social_accounts_platform_check";--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_check" CHECK ("platform" IN ('messenger', 'instagram', 'whatsapp'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campaign_id" uuid NOT NULL REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"buyer_key" varchar(80) NOT NULL,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"name" varchar(160),
	"thread_id" uuid REFERENCES "social_threads"("id") ON DELETE SET NULL,
	-- PSID / IG-scoped id / WhatsApp wa_id.
	"recipient_id" varchar(64),
	-- session = free-form inside the 24 h window; template = approved WhatsApp template.
	"mode" varchar(10) NOT NULL CHECK ("mode" IN ('session', 'template', 'none')),
	"last_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
	"last_item" varchar(160),
	"status" varchar(10) DEFAULT 'queued' NOT NULL CHECK ("status" IN ('queued', 'sent', 'failed', 'skipped')),
	"skip_reason" varchar(40),
	"body" text,
	"error" varchar(300),
	"sent_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_recipients_buyer_idx" ON "broadcast_recipients" ("campaign_id", "buyer_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_recipients_queue_idx" ON "broadcast_recipients" ("campaign_id", "status");--> statement-breakpoint

ALTER TABLE "broadcast_campaigns" ADD COLUMN IF NOT EXISTS "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "broadcast_campaigns" ADD COLUMN IF NOT EXISTS "wa_template_language" varchar(10) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_campaigns" ADD COLUMN IF NOT EXISTS "skipped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_campaigns" ADD COLUMN IF NOT EXISTS "ai_polished" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "review_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
	"delivery_id" uuid REFERENCES "deliveries"("id") ON DELETE SET NULL,
	"thread_id" uuid REFERENCES "social_threads"("id") ON DELETE SET NULL,
	"channel" varchar(12),
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(12) DEFAULT 'scheduled' NOT NULL
		CHECK ("status" IN ('scheduled', 'sent', 'reviewed', 'skipped', 'failed', 'expired')),
	"skip_reason" varchar(40),
	"sent_at" timestamp with time zone,
	"rating" smallint CHECK ("rating" BETWEEN 1 AND 5),
	"body" text,
	"photos_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"voucher_card_id" uuid REFERENCES "gift_cards"("id") ON DELETE SET NULL,
	"reviewed_at" timestamp with time zone,
	"error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_prompts_order_idx" ON "review_prompts" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_prompts_due_idx" ON "review_prompts" ("due_at") WHERE "status" = 'scheduled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_prompts_thread_idx" ON "review_prompts" ("thread_id") WHERE "status" = 'sent';--> statement-breakpoint

ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "single_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_suite_settings" (
	"tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
	"review_loop_enabled" boolean DEFAULT true NOT NULL,
	"review_voucher_amount" numeric(10, 2) DEFAULT 50 NOT NULL CHECK ("review_voucher_amount" >= 0 AND "review_voucher_amount" <= 5000),
	"review_voucher_days" smallint DEFAULT 30 NOT NULL CHECK ("review_voucher_days" BETWEEN 1 AND 365),
	-- Approved WhatsApp templates (Utility for the review ask, Marketing for broadcasts).
	"wa_review_template" varchar(120),
	"wa_template_language" varchar(10) DEFAULT 'en' NOT NULL,
	"payday_alert_dismissed_for" varchar(10),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "printair_upsells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"milestone" varchar(20) NOT NULL
		CHECK ("milestone" IN ('first_campaign', 'orders_10', 'orders_50', 'orders_100', 'orders_500')),
	"ai_media_job_id" uuid REFERENCES "ai_media_jobs"("id") ON DELETE SET NULL,
	"status" varchar(10) DEFAULT 'rendering' NOT NULL CHECK ("status" IN ('rendering', 'ready', 'failed', 'dismissed', 'ordered')),
	"handoffs" integer DEFAULT 0 NOT NULL,
	"last_handoff_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "printair_upsells_milestone_idx" ON "printair_upsells" ("tenant_id", "milestone");
