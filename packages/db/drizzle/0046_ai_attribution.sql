-- AI attribution (CTO review 2026-11-16): record whether a sale came out of an AI conversation,
-- so AI-assisted orders, AI-closed revenue and conversation-to-purchase rate can be reported.
--
-- 1. checkout_links.origin: who made the link — 'seller' (default), 'ai_draft' (AI drafted the
--    reply, the seller sent it) or 'ai_auto' (AI sent it with no seller action) — plus the shop-chat
--    session or Messenger/Instagram thread it was made for.
-- 2. orders.ai_assisted / ai_closed / chat_session_id: copied from the link (or the shop
--    assistant's utm tag) in the same transaction that creates the order.
-- 3. social_messages.ai_origin: 'draft' or 'auto' on replies the AI wrote.
--
-- Additive only: new nullable / defaulted columns, no table rewrites, no backfill needed.

ALTER TABLE "checkout_links" ADD COLUMN IF NOT EXISTS "origin" varchar(12) DEFAULT 'seller' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_links" ADD COLUMN IF NOT EXISTS "chat_session_id" varchar(64);--> statement-breakpoint
ALTER TABLE "checkout_links" ADD COLUMN IF NOT EXISTS "social_thread_id" uuid REFERENCES "social_threads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ai_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "chat_session_id" varchar(64);--> statement-breakpoint
ALTER TABLE "social_messages" ADD COLUMN IF NOT EXISTS "ai_origin" varchar(8);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_ai_assisted_idx" ON "orders" ("tenant_id", "created_at") WHERE "ai_assisted";
