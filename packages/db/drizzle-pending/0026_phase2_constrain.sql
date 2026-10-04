-- 0026_phase2_constrain — run ONLY after phase2-verify.sql returns 0 rows for
-- V1–V4 on production (docs/PHASE-2-MIGRATION-SPEC.md §7 step 4).
-- To apply: move this file into packages/db/drizzle/, add a journal entry
-- (idx 23) and run `pnpm --filter @gumakart/db migrate`.

ALTER TABLE "orders" ALTER COLUMN "order_state" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_state" SET DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_state" SET DEFAULT 'unfulfilled';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "order_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "fulfillment_state" SET NOT NULL;--> statement-breakpoint

-- Invariants 1 and 2 (mirror invariantViolation() in queries/order-state.ts).
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_is_paid_and_delivered"
  CHECK ("order_state" <> 'completed' OR ("payment_state" = 'paid' AND "fulfillment_state" = 'delivered'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_not_in_transit"
  CHECK ("order_state" <> 'cancelled' OR (
    "fulfillment_state" NOT IN ('picked_up', 'out_for_delivery')
    AND ("fulfillment_state" <> 'delivered' OR "payment_state" = 'refunded')
  ));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_due_only_for_cod"
  CHECK ("payment_state" <> 'cod_due' OR "payment_method" = 'cod');--> statement-breakpoint

-- At most one live charge per order.
-- POS split tender (Phase 5) records up to two paid rows per sale (ids "pos_<order>_<n>"),
-- so POS tenders are outside the one-live-charge rule.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_one_live_charge_idx"
  ON "payment_transactions" USING btree ("order_id")
  WHERE "status" IN ('pending', 'processing', 'paid') AND coalesce("gateway_intent_id", '') NOT LIKE 'pos\_%';
