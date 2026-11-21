-- AI Marketing Suite Phase 3: comment-to-DM, 24/7 Taglish AI sales closer, abandoned-cart recovery.
--
-- 1. social_comment_actions — one row per Facebook/Instagram comment we acted on. The unique
--    (account_id, comment_id) makes webhook retries harmless: a comment gets at most one public
--    reply and one private reply (Meta allows exactly one private reply per comment anyway).
-- 2. social_accounts.ai_closer_mode — per connected Page / IG / WhatsApp number: 'auto' (AI
--    answers DMs on Pro Live / Enterprise Vibe) or 'off'.
-- 3. social_threads.checkout_link_sent_at — when the active checkout link was sent; the
--    30-minute recovery job keys on it.
-- 4. abandoned_cart_nudges unique (thread_id, checkout_link_id) — at most one recovery nudge per
--    chat per link, even if two cron runs overlap.
-- 5. checkout_links.prefill_json — buyer details the AI collected in chat (name, phone, street,
--    preferred payment), shown pre-filled on that link's checkout page. Never put in the URL.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "social_comment_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"account_id" uuid NOT NULL REFERENCES "social_accounts"("id") ON DELETE CASCADE,
	"platform" varchar(16) NOT NULL,
	"comment_id" varchar(128) NOT NULL,
	"post_id" varchar(128),
	"commenter_id" varchar(64),
	"commenter_name" varchar(160),
	"comment_text" varchar(1000),
	"rule_id" uuid REFERENCES "social_automation_rules"("id") ON DELETE SET NULL,
	"matched_keyword" varchar(60),
	"status" varchar(12) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'replied', 'skipped', 'failed')),
	"skip_reason" varchar(60),
	"public_reply_id" varchar(128),
	"private_reply_id" varchar(160),
	"thread_id" uuid REFERENCES "social_threads"("id") ON DELETE SET NULL,
	"error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_comment_actions_comment_idx" ON "social_comment_actions" ("account_id", "comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_comment_actions_commenter_idx" ON "social_comment_actions" ("account_id", "post_id", "commenter_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_comment_actions_tenant_idx" ON "social_comment_actions" ("tenant_id", "created_at");--> statement-breakpoint

ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "ai_closer_mode" varchar(8) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_ai_closer_mode_chk" CHECK ("ai_closer_mode" IN ('auto', 'off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "checkout_link_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_threads_recovery_idx" ON "social_threads" ("checkout_link_sent_at")
	WHERE "active_checkout_link_id" IS NOT NULL AND "nudge_sent_at" IS NULL AND NOT "ai_paused";--> statement-breakpoint

ALTER TABLE "checkout_links" ADD COLUMN IF NOT EXISTS "prefill_json" jsonb;;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_nudges_thread_link_idx" ON "abandoned_cart_nudges" ("thread_id", "checkout_link_id")
	WHERE "thread_id" IS NOT NULL AND "checkout_link_id" IS NOT NULL;
