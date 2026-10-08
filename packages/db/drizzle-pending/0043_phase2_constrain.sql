-- phase2_constrain — run ONLY after phase2-verify.sql returns 0 rows for
-- V1–V4 on production (docs/PHASE-2-MIGRATION-SPEC.md §7 step 4).
-- To apply: move this file into packages/db/drizzle/ as the next index (0045+),
-- add a journal entry and run `pnpm --filter @gumakart/db migrate`.
--
-- Security G2 (GK-15) rewrite:
--   * every CHECK is added NOT VALID and validated in a second statement, and
--     NOT NULL is set only after a validated CHECK (… IS NOT NULL) exists, so
--     Postgres never takes a long rewrite/scan lock on `orders`;
--   * the one-live-charge rule leaves out gift-card rows as well as POS
--     tenders: a gift card + online/COD checkout legitimately has two live
--     charge rows (`giftcard_<order>` paid, plus the balance due), which the
--     old index would have refused at checkout.

ALTER TABLE "orders" ALTER COLUMN "order_state" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_state" SET DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_state" SET DEFAULT 'unfulfilled';--> statement-breakpoint

-- NOT NULL without a table scan under an ACCESS EXCLUSIVE lock (PG 12+ uses the validated CHECK).
ALTER TABLE "orders" ADD CONSTRAINT "orders_states_present" CHECK ("order_state" IS NOT NULL AND "payment_state" IS NOT NULL AND "fulfillment_state" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_states_present";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "order_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_states_present";--> statement-breakpoint

-- Invariants 1 and 2 (mirror invariantViolation() in queries/order-state.ts).
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_is_paid_and_delivered"
  CHECK ("order_state" <> 'completed' OR ("payment_state" = 'paid' AND "fulfillment_state" = 'delivered')) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_completed_is_paid_and_delivered";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_not_in_transit"
  CHECK ("order_state" <> 'cancelled' OR (
    "fulfillment_state" NOT IN ('picked_up', 'out_for_delivery')
    AND ("fulfillment_state" <> 'delivered' OR "payment_state" = 'refunded')
  )) NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_cancelled_not_in_transit";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_due_only_for_cod"
  CHECK ("payment_state" <> 'cod_due' OR "payment_method" = 'cod') NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_cod_due_only_for_cod";--> statement-breakpoint

-- At most one live charge per order, apart from:
--   POS split tender (Phase 5): up to two paid rows per sale (ids "pos_<order>_<n>");
--   gift cards (Phase 17): the "giftcard_<order>" paid row sits beside the balance due.
-- CONCURRENTLY cannot run inside the migration transaction; on a large table build it by hand first.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_one_live_charge_idx"
  ON "payment_transactions" USING btree ("order_id")
  WHERE "status" IN ('pending', 'processing', 'paid')
    AND coalesce("gateway_intent_id", '') NOT LIKE 'pos\_%'
    AND coalesce("gateway_intent_id", '') NOT LIKE 'giftcard\_%';
