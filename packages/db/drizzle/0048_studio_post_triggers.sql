-- AI Marketing Suite Phase 2: "Save to Post & Attach Comment-to-DM Trigger".
--
-- A Marketing Studio post is saved to content_queue with a comment-to-DM rule attached to it.
-- The rule is PENDING (post_id NULL) until the seller publishes and pastes the post link; then
-- post_id is set and Phase 3's webhook matches comments on that post.
--
--   rule kind        content_queue_id   post_id
--   global           NULL               NULL      (one per shop/account — unchanged)
--   post (manual)    NULL               set
--   studio pending   set                NULL      (never matched by the webhook)
--   studio active    set                set
--
-- Additive: two nullable columns; the scope index is rebuilt to ignore pending rules.

ALTER TABLE "social_automation_rules" ADD COLUMN IF NOT EXISTS "content_queue_id" uuid REFERENCES "content_queue"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_automation_rules" ADD COLUMN IF NOT EXISTS "post_url" text;--> statement-breakpoint
DROP INDEX IF EXISTS "social_automation_rules_scope_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_automation_rules_scope_idx" ON "social_automation_rules" ("tenant_id", "account_id", "post_id") NULLS NOT DISTINCT
	WHERE "content_queue_id" IS NULL OR "post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_automation_rules_content_idx" ON "social_automation_rules" ("content_queue_id") WHERE "content_queue_id" IS NOT NULL;
