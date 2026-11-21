-- AI Social Marketing & Commerce Suite — Phase 1 (IMPLEMENTATION_PLAN.md, 2026-11-21).
--
-- Adds the new AI-suite tiers (free / starter ₱999 / pro_live ₱2,999 / enterprise_vibe ₱5,999)
-- WITHOUT changing what existing subscribers get:
--   * tenants.subscription_plan keeps its existing values. Legacy ids stay valid forever:
--       growth = "Pro" ₱499, pro = "Advance" ₱999 (see @gumakart/plans catalog.ts).
--     Both are seeded as is_grandfathered tiers. They keep every feature they have today and
--     additionally get Starter-level AI media entitlements.
--   * Stored aliases are canonicalised first (starter→growth, advance→pro, sulit/''→free).
--     normalizePlanId() already maps them the same way, so nothing changes for those shops;
--     it frees the id `starter` to mean the new ₱999 Starter tier.
--   * merchant_entitlements is kept in sync with tenants.subscription_plan by trigger, so the
--     existing PayMongo billing flow (markPlanPaymentPaidByIntent) needs no change.
--
-- Social tables REUSE the existing Phase 13 inbox instead of duplicating it:
--   plan "social_connections"   → social_accounts  (+ ig_business_id, phone_number_id, waba_id, webhook token)
--   plan "social_conversations" → social_threads   (+ cart / nudge / conversion / AI-pause state;
--                                  buyer messages already live in social_messages)
--
-- Additive only: new tables, new nullable/defaulted columns, no rewrites of existing tables.

-- ── 0. Canonicalise stored plan aliases (behaviour-preserving) ─────────────────
UPDATE "tenants" SET "subscription_plan" = 'growth' WHERE lower(btrim("subscription_plan")) = 'starter';--> statement-breakpoint
UPDATE "tenants" SET "subscription_plan" = 'pro' WHERE lower(btrim("subscription_plan")) = 'advance';--> statement-breakpoint
UPDATE "tenants" SET "subscription_plan" = 'free' WHERE "subscription_plan" IS NULL OR lower(btrim("subscription_plan")) IN ('sulit', '');--> statement-breakpoint

-- ── 1. Tier catalog (mirror of AI_SUITE_TIERS in @gumakart/plans/src/ai-suite.ts) ──
CREATE TABLE IF NOT EXISTS "subscription_tiers" (
	"id" varchar(32) PRIMARY KEY,
	"display_name" varchar(64) NOT NULL,
	"price_monthly_php" numeric(12, 2) NOT NULL CHECK ("price_monthly_php" >= 0),
	"is_legacy" boolean DEFAULT false NOT NULL,
	"is_grandfathered" boolean DEFAULT false NOT NULL,
	-- Which legacy plan id existing feature gates (normalizePlanId / PLAN_AI_LIMITS) treat this tier as.
	"legacy_feature_plan" varchar(16) NOT NULL CHECK ("legacy_feature_plan" IN ('free', 'growth', 'pro')),
	-- -1 = unlimited, 0 = not included.
	"photo_credits_limit" integer NOT NULL CHECK ("photo_credits_limit" >= -1),
	"video_credits_limit" integer NOT NULL CHECK ("video_credits_limit" >= -1),
	"ai_closer_enabled" boolean DEFAULT false NOT NULL,
	"broadcast_enabled" boolean DEFAULT false NOT NULL,
	"voice_clone_enabled" boolean DEFAULT false NOT NULL,
	"vibe_coding_enabled" boolean DEFAULT false NOT NULL,
	-- BullMQ priority: 1 = served first.
	"queue_priority" smallint NOT NULL CHECK ("queue_priority" BETWEEN 1 AND 10),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

INSERT INTO "subscription_tiers"
	("id", "display_name", "price_monthly_php", "is_legacy", "is_grandfathered", "legacy_feature_plan",
	 "photo_credits_limit", "video_credits_limit", "ai_closer_enabled", "broadcast_enabled",
	 "voice_clone_enabled", "vibe_coding_enabled", "queue_priority", "sort_order")
VALUES
	('free',            'Free',            0,    false, false, 'free',   0,  0,  false, false, false, false, 4, 0),
	('starter',         'Starter',         999,  false, false, 'growth', 20, 0,  false, false, false, false, 3, 10),
	('pro_live',        'Pro Live',        2999, false, false, 'pro',    100, 10, true,  true,  false, false, 2, 20),
	('enterprise_vibe', 'Enterprise Vibe', 5999, false, false, 'pro',    -1, 40, true,  true,  true,  true,  1, 30),
	('growth',          'Pro (legacy)',    499,  true,  true,  'growth', 20, 0,  false, false, false, false, 3, 90),
	('pro',             'Advance (legacy)', 999, true,  true,  'pro',    20, 0,  false, false, false, false, 3, 91)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- Any stored plan string → tier id. Mirrors resolveAiSuiteTierId() in TypeScript.
CREATE OR REPLACE FUNCTION "ai_suite_tier_for_plan"(p_plan text) RETURNS varchar
LANGUAGE plpgsql STABLE AS $$
DECLARE
	v text := lower(btrim(coalesce(p_plan, '')));
BEGIN
	IF v = 'advance' THEN RETURN 'pro'; END IF;
	IF v IN ('', 'sulit') THEN RETURN 'free'; END IF;
	IF EXISTS (SELECT 1 FROM "subscription_tiers" WHERE "id" = v) THEN RETURN v; END IF;
	RETURN 'free';
END;
$$;--> statement-breakpoint

-- Monthly credit period, calendar month in Philippine time (same as ai_usage_monthly.period_month).
CREATE OR REPLACE FUNCTION "ai_suite_current_period"() RETURNS date
LANGUAGE sql STABLE AS $$
	SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Manila'))::date;
$$;--> statement-breakpoint

-- ── 2. Per-shop entitlements + rolling monthly credit counters ─────────────────
CREATE TABLE IF NOT EXISTS "merchant_entitlements" (
	"tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
	"tier_id" varchar(32) NOT NULL REFERENCES "subscription_tiers"("id"),
	"is_grandfathered" boolean DEFAULT false NOT NULL,
	"photo_credits_limit" integer NOT NULL CHECK ("photo_credits_limit" >= -1),
	"video_credits_limit" integer NOT NULL CHECK ("video_credits_limit" >= -1),
	"ai_closer_enabled" boolean DEFAULT false NOT NULL,
	"broadcast_enabled" boolean DEFAULT false NOT NULL,
	"voice_clone_enabled" boolean DEFAULT false NOT NULL,
	"vibe_coding_enabled" boolean DEFAULT false NOT NULL,
	"queue_priority" smallint NOT NULL CHECK ("queue_priority" BETWEEN 1 AND 10),
	-- Set by a platform admin for promos/comps: tier changes then keep the limits and flags above.
	"limits_overridden" boolean DEFAULT false NOT NULL,
	"period_start" date DEFAULT "ai_suite_current_period"() NOT NULL,
	"photo_credits_used" integer DEFAULT 0 NOT NULL CHECK ("photo_credits_used" >= 0),
	"video_credits_used" integer DEFAULT 0 NOT NULL CHECK ("video_credits_used" >= 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_entitlements_tier_idx" ON "merchant_entitlements" ("tier_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "ai_suite_sync_entitlements"(p_tenant uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "merchant_entitlements" AS me
		("tenant_id", "tier_id", "is_grandfathered", "photo_credits_limit", "video_credits_limit",
		 "ai_closer_enabled", "broadcast_enabled", "voice_clone_enabled", "vibe_coding_enabled", "queue_priority")
	SELECT t."id", st."id", st."is_grandfathered", st."photo_credits_limit", st."video_credits_limit",
		st."ai_closer_enabled", st."broadcast_enabled", st."voice_clone_enabled", st."vibe_coding_enabled", st."queue_priority"
	FROM "tenants" t
	JOIN "subscription_tiers" st ON st."id" = "ai_suite_tier_for_plan"(t."subscription_plan")
	WHERE t."id" = p_tenant
	ON CONFLICT ("tenant_id") DO UPDATE SET
		"tier_id" = EXCLUDED."tier_id",
		"is_grandfathered" = EXCLUDED."is_grandfathered",
		"photo_credits_limit" = CASE WHEN me."limits_overridden" THEN me."photo_credits_limit" ELSE EXCLUDED."photo_credits_limit" END,
		"video_credits_limit" = CASE WHEN me."limits_overridden" THEN me."video_credits_limit" ELSE EXCLUDED."video_credits_limit" END,
		"ai_closer_enabled"   = CASE WHEN me."limits_overridden" THEN me."ai_closer_enabled" ELSE EXCLUDED."ai_closer_enabled" END,
		"broadcast_enabled"   = CASE WHEN me."limits_overridden" THEN me."broadcast_enabled" ELSE EXCLUDED."broadcast_enabled" END,
		"voice_clone_enabled" = CASE WHEN me."limits_overridden" THEN me."voice_clone_enabled" ELSE EXCLUDED."voice_clone_enabled" END,
		"vibe_coding_enabled" = CASE WHEN me."limits_overridden" THEN me."vibe_coding_enabled" ELSE EXCLUDED."vibe_coding_enabled" END,
		"queue_priority"      = CASE WHEN me."limits_overridden" THEN me."queue_priority" ELSE EXCLUDED."queue_priority" END,
		"updated_at" = now();
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "trg_tenants_sync_ai_entitlements"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "ai_suite_sync_entitlements"(NEW."id");
	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenants_sync_ai_entitlements_ins" ON "tenants";--> statement-breakpoint
CREATE TRIGGER "tenants_sync_ai_entitlements_ins" AFTER INSERT ON "tenants"
	FOR EACH ROW EXECUTE FUNCTION "trg_tenants_sync_ai_entitlements"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenants_sync_ai_entitlements_upd" ON "tenants";--> statement-breakpoint
CREATE TRIGGER "tenants_sync_ai_entitlements_upd" AFTER UPDATE OF "subscription_plan" ON "tenants"
	FOR EACH ROW WHEN (OLD."subscription_plan" IS DISTINCT FROM NEW."subscription_plan")
	EXECUTE FUNCTION "trg_tenants_sync_ai_entitlements"();--> statement-breakpoint

-- Editing a tier's limits re-applies them to every shop on that tier (except overridden ones).
CREATE OR REPLACE FUNCTION "trg_subscription_tiers_resync"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "merchant_entitlements" SET
		"is_grandfathered" = NEW."is_grandfathered",
		"photo_credits_limit" = NEW."photo_credits_limit",
		"video_credits_limit" = NEW."video_credits_limit",
		"ai_closer_enabled" = NEW."ai_closer_enabled",
		"broadcast_enabled" = NEW."broadcast_enabled",
		"voice_clone_enabled" = NEW."voice_clone_enabled",
		"vibe_coding_enabled" = NEW."vibe_coding_enabled",
		"queue_priority" = NEW."queue_priority",
		"updated_at" = now()
	WHERE "tier_id" = NEW."id" AND NOT "limits_overridden";
	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "subscription_tiers_resync" ON "subscription_tiers";--> statement-breakpoint
CREATE TRIGGER "subscription_tiers_resync" AFTER UPDATE ON "subscription_tiers"
	FOR EACH ROW EXECUTE FUNCTION "trg_subscription_tiers_resync"();--> statement-breakpoint

-- Backfill every existing shop.
INSERT INTO "merchant_entitlements"
	("tenant_id", "tier_id", "is_grandfathered", "photo_credits_limit", "video_credits_limit",
	 "ai_closer_enabled", "broadcast_enabled", "voice_clone_enabled", "vibe_coding_enabled", "queue_priority")
SELECT t."id", st."id", st."is_grandfathered", st."photo_credits_limit", st."video_credits_limit",
	st."ai_closer_enabled", st."broadcast_enabled", st."voice_clone_enabled", st."vibe_coding_enabled", st."queue_priority"
FROM "tenants" t
JOIN "subscription_tiers" st ON st."id" = "ai_suite_tier_for_plan"(t."subscription_plan")
ON CONFLICT ("tenant_id") DO NOTHING;--> statement-breakpoint

-- Atomically take one credit. Returns the credit period it was taken from, or NULL when the
-- shop has no entitlement / is out of credits. Rolls the month over in the same statement.
CREATE OR REPLACE FUNCTION "ai_suite_reserve_credit"(p_tenant uuid, p_kind text) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE
	cur date := "ai_suite_current_period"();
	taken date;
BEGIN
	IF p_kind = 'photo' THEN
		UPDATE "merchant_entitlements" SET
			"photo_credits_used" = CASE WHEN "period_start" < cur THEN 1 ELSE "photo_credits_used" + 1 END,
			"video_credits_used" = CASE WHEN "period_start" < cur THEN 0 ELSE "video_credits_used" END,
			"period_start" = cur,
			"updated_at" = now()
		WHERE "tenant_id" = p_tenant
			AND "photo_credits_limit" <> 0
			AND ("photo_credits_limit" = -1
				OR (CASE WHEN "period_start" < cur THEN 0 ELSE "photo_credits_used" END) < "photo_credits_limit")
		RETURNING "period_start" INTO taken;
	ELSIF p_kind = 'video' THEN
		UPDATE "merchant_entitlements" SET
			"video_credits_used" = CASE WHEN "period_start" < cur THEN 1 ELSE "video_credits_used" + 1 END,
			"photo_credits_used" = CASE WHEN "period_start" < cur THEN 0 ELSE "photo_credits_used" END,
			"period_start" = cur,
			"updated_at" = now()
		WHERE "tenant_id" = p_tenant
			AND "video_credits_limit" <> 0
			AND ("video_credits_limit" = -1
				OR (CASE WHEN "period_start" < cur THEN 0 ELSE "video_credits_used" END) < "video_credits_limit")
		RETURNING "period_start" INTO taken;
	ELSE
		RAISE EXCEPTION 'unknown credit kind: %', p_kind;
	END IF;
	RETURN taken;
END;
$$;--> statement-breakpoint

-- Give a credit back, only into the period it was taken from (a failure that lands after the
-- month rolled over doesn't inflate next month's allowance).
CREATE OR REPLACE FUNCTION "ai_suite_refund_credit"(p_tenant uuid, p_kind text, p_period date) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
	n integer;
BEGIN
	IF p_kind = 'photo' THEN
		UPDATE "merchant_entitlements" SET "photo_credits_used" = greatest("photo_credits_used" - 1, 0), "updated_at" = now()
		WHERE "tenant_id" = p_tenant AND "period_start" = p_period;
	ELSIF p_kind = 'video' THEN
		UPDATE "merchant_entitlements" SET "video_credits_used" = greatest("video_credits_used" - 1, 0), "updated_at" = now()
		WHERE "tenant_id" = p_tenant AND "period_start" = p_period;
	ELSE
		RAISE EXCEPTION 'unknown credit kind: %', p_kind;
	END IF;
	GET DIAGNOSTICS n = ROW_COUNT;
	RETURN n > 0;
END;
$$;--> statement-breakpoint

-- ── 3. GPU media jobs (DB row = source of truth; the gpu-bridge dispatcher relays it to BullMQ) ──
CREATE TABLE IF NOT EXISTS "ai_media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
	"job_type" varchar(24) NOT NULL CHECK ("job_type" IN ('product_photo', 'video_ad', 'voice_clone', 'printair_mockup')),
	"status" varchar(12) DEFAULT 'queued' NOT NULL CHECK ("status" IN ('queued', 'processing', 'completed', 'failed')),
	"priority" smallint DEFAULT 3 NOT NULL CHECK ("priority" BETWEEN 1 AND 10),
	"input_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gpu_node_id" text,
	"error_message" text,
	"credit_kind" varchar(8) CHECK ("credit_kind" IN ('photo', 'video')),
	"credit_status" varchar(10) DEFAULT 'none' NOT NULL CHECK ("credit_status" IN ('none', 'reserved', 'consumed', 'refunded')),
	"credit_period" date,
	"idempotency_key" varchar(120),
	"attempts" integer DEFAULT 0 NOT NULL,
	-- NULL while the job waits in the DB (e.g. GPU node offline); set when handed to BullMQ.
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_media_jobs_credit_chk" CHECK (
		("credit_kind" IS NULL AND "credit_status" = 'none')
		OR ("credit_kind" IS NOT NULL AND "credit_status" <> 'none' AND "credit_period" IS NOT NULL)
	),
	CONSTRAINT "ai_media_jobs_terminal_chk" CHECK (("status" IN ('completed', 'failed')) = ("completed_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_media_jobs_idem_idx" ON "ai_media_jobs" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_media_jobs_dispatch_idx" ON "ai_media_jobs" ("priority", "created_at") WHERE "status" = 'queued' AND "dispatched_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_media_jobs_tenant_idx" ON "ai_media_jobs" ("tenant_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_media_jobs_inflight_idx" ON "ai_media_jobs" ("status", "updated_at") WHERE "status" IN ('queued', 'processing');--> statement-breakpoint

-- Live dashboard updates: NOTIFY on every status change (Phase 2 streams this to the seller UI).
CREATE OR REPLACE FUNCTION "trg_ai_media_jobs_notify"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('ai_media_jobs', json_build_object(
		'id', NEW."id", 'tenantId', NEW."tenant_id", 'status', NEW."status", 'jobType', NEW."job_type"
	)::text);
	RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_media_jobs_notify" ON "ai_media_jobs";--> statement-breakpoint
CREATE TRIGGER "ai_media_jobs_notify" AFTER INSERT OR UPDATE OF "status" ON "ai_media_jobs"
	FOR EACH ROW EXECUTE FUNCTION "trg_ai_media_jobs_notify"();--> statement-breakpoint

-- ── 4. Social connections (extend social_accounts) + comment-to-DM rules ─────────
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "ig_business_id" varchar(64);--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "phone_number_id" varchar(64);--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "waba_id" varchar(64);--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "webhook_token_sealed" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "social_automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	-- NULL = every connected account of the shop.
	"account_id" uuid REFERENCES "social_accounts"("id") ON DELETE CASCADE,
	-- NULL = global rule for all posts.
	"post_id" varchar(128),
	"product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
	"trigger_keywords" text[] DEFAULT ARRAY['HM', 'MINE', 'Available pa?', 'Details', 'Magkano']::text[] NOT NULL,
	"public_reply_templates" text[] DEFAULT ARRAY[
		'Sent you a DM po! Check your message requests',
		'Hi! Nag-PM na kami sa inyo po, check your inbox',
		'Check your messages po — sent the details!'
	]::text[] NOT NULL,
	"dm_flow_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_automation_rules_scope_idx" ON "social_automation_rules" ("tenant_id", "account_id", "post_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_automation_rules_post_idx" ON "social_automation_rules" ("post_id") WHERE "is_active";--> statement-breakpoint

-- ── 5. Conversation state (extend social_threads) + abandoned-cart nudges ────────
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "active_checkout_link_id" uuid REFERENCES "checkout_links"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "ai_context_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "nudge_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "conversion_status" varchar(20) DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "ai_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_threads" ADD COLUMN IF NOT EXISTS "escalation_reason" varchar(300);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "social_threads" ADD CONSTRAINT "social_threads_conversion_status_chk"
		CHECK ("conversion_status" IN ('open', 'cart', 'checkout_started', 'converted', 'lost', 'escalated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_threads_nudge_idx" ON "social_threads" ("tenant_id", "last_inbound_at")
	WHERE "active_checkout_link_id" IS NOT NULL AND "nudge_sent_at" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "abandoned_cart_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"thread_id" uuid REFERENCES "social_threads"("id") ON DELETE CASCADE,
	"checkout_link_id" uuid REFERENCES "checkout_links"("id") ON DELETE CASCADE,
	"checkout_session_id" uuid REFERENCES "checkout_sessions"("id") ON DELETE CASCADE,
	"channel" varchar(12) NOT NULL CHECK ("channel" IN ('messenger', 'instagram', 'whatsapp', 'tiktok', 'sms')),
	"status" varchar(10) DEFAULT 'scheduled' NOT NULL CHECK ("status" IN ('scheduled', 'sent', 'skipped', 'failed')),
	"message_body" text,
	"error" varchar(300),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "abandoned_cart_nudges_target_chk" CHECK ("checkout_link_id" IS NOT NULL OR "checkout_session_id" IS NOT NULL)
);--> statement-breakpoint
-- One nudge per cart per conversation, so the 5-minute cron can never double-send.
CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_nudges_once_idx" ON "abandoned_cart_nudges" ("tenant_id", "thread_id", "checkout_link_id", "checkout_session_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abandoned_cart_nudges_tenant_idx" ON "abandoned_cart_nudges" ("tenant_id", "created_at");--> statement-breakpoint

-- ── 6. Buyer CRM segments + broadcast campaigns ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "buyer_crm_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	-- 'phone:<last 10 digits>' — one buyer per phone per shop.
	"buyer_key" varchar(80) NOT NULL,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"phone" varchar(20),
	"psid" varchar(64),
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT 0 NOT NULL,
	"last_order_at" timestamp with time zone,
	"payday_orders" integer DEFAULT 0 NOT NULL,
	-- Share of orders placed on days 13–17 or 28–31 (Philippine time), 0..1.
	"payday_shopper_score" numeric(5, 4) DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_crm_segments_buyer_idx" ON "buyer_crm_segments" ("tenant_id", "buyer_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_crm_segments_tags_idx" ON "buyer_crm_segments" USING gin ("tags");--> statement-breakpoint

-- Rebuild one shop's segments from its orders. Phase 4 runs this nightly per shop.
CREATE OR REPLACE FUNCTION "refresh_buyer_crm_segments"(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
	n integer;
BEGIN
	WITH base AS (
		SELECT
			'phone:' || right(regexp_replace(coalesce(c."phone", o."guest_phone"), '\D', '', 'g'), 10) AS buyer_key,
			c."id" AS customer_id,
			coalesce(c."phone", o."guest_phone") AS phone,
			o."total",
			o."created_at",
			extract(day FROM o."created_at" AT TIME ZONE 'Asia/Manila')::int AS dom
		FROM "orders" o
		LEFT JOIN "customers" c ON c."id" = o."customer_record_id" AND c."tenant_id" = o."tenant_id"
		WHERE o."tenant_id" = p_tenant
			AND o."voided_at" IS NULL
			AND coalesce(o."order_state"::text, 'open') <> 'cancelled'
			AND coalesce(o."payment_state"::text, '') NOT IN ('failed', 'refunded')
			AND length(regexp_replace(coalesce(c."phone", o."guest_phone", ''), '\D', '', 'g')) >= 10
	), agg AS (
		SELECT
			buyer_key,
			(array_agg(customer_id ORDER BY created_at DESC) FILTER (WHERE customer_id IS NOT NULL))[1] AS customer_id,
			(array_agg(phone ORDER BY created_at DESC))[1] AS phone,
			count(*)::int AS total_orders,
			coalesce(sum("total"), 0) AS total_spent,
			max(created_at) AS last_order_at,
			count(*) FILTER (WHERE dom BETWEEN 13 AND 17 OR dom >= 28)::int AS payday_orders
		FROM base GROUP BY buyer_key
	), upserted AS (
		INSERT INTO "buyer_crm_segments" AS s
			("tenant_id", "buyer_key", "customer_id", "phone", "psid", "total_orders", "total_spent",
			 "last_order_at", "payday_orders", "payday_shopper_score", "tags", "refreshed_at")
		SELECT p_tenant, a.buyer_key, a.customer_id, a.phone,
			(SELECT st."external_user_id" FROM "social_threads" st
				WHERE st."tenant_id" = p_tenant AND a.customer_id IS NOT NULL AND st."customer_id" = a.customer_id
				ORDER BY st."last_message_at" DESC LIMIT 1),
			a.total_orders, a.total_spent, a.last_order_at, a.payday_orders,
			round(a.payday_orders::numeric / a.total_orders, 4),
			array_remove(ARRAY[
				CASE WHEN a.total_orders >= 3 THEN 'VIP_REPEAT' END,
				CASE WHEN a.payday_orders * 2 >= a.total_orders THEN 'PAYDAY_SHOPPER' END,
				CASE WHEN a.last_order_at < now() - interval '60 days' THEN 'INACTIVE_60D' END
			], NULL),
			now()
		FROM agg a
		ON CONFLICT ("tenant_id", "buyer_key") DO UPDATE SET
			"customer_id" = EXCLUDED."customer_id", "phone" = EXCLUDED."phone",
			"psid" = coalesce(EXCLUDED."psid", s."psid"),
			"total_orders" = EXCLUDED."total_orders", "total_spent" = EXCLUDED."total_spent",
			"last_order_at" = EXCLUDED."last_order_at", "payday_orders" = EXCLUDED."payday_orders",
			"payday_shopper_score" = EXCLUDED."payday_shopper_score", "tags" = EXCLUDED."tags",
			"refreshed_at" = now()
		RETURNING s."buyer_key"
	)
	SELECT count(*) INTO n FROM upserted;

	-- Buyers whose orders were all cancelled/voided since the last run drop out.
	DELETE FROM "buyer_crm_segments" s
	WHERE s."tenant_id" = p_tenant AND s."refreshed_at" < now();

	RETURN n;
END;
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "broadcast_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"name" varchar(120) NOT NULL,
	"channel" varchar(12) NOT NULL CHECK ("channel" IN ('messenger', 'instagram', 'whatsapp')),
	-- Recipients = buyers whose buyer_crm_segments.tags overlap these (empty = all buyers).
	"segment_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"kind" varchar(12) DEFAULT 'custom' NOT NULL CHECK ("kind" IN ('payday', 'restock', 'custom')),
	"message_template" text NOT NULL,
	-- WhatsApp approved template name, when channel = whatsapp.
	"wa_template_name" varchar(120),
	"status" varchar(12) DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
	"scheduled_at" timestamp with time zone,
	"rate_limit_per_sec" smallint DEFAULT 10 NOT NULL CHECK ("rate_limit_per_sec" BETWEEN 1 AND 80),
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_by_name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_campaigns_tenant_idx" ON "broadcast_campaigns" ("tenant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_campaigns_due_idx" ON "broadcast_campaigns" ("scheduled_at") WHERE "status" = 'scheduled';
