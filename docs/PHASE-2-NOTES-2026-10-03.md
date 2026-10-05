# Phase 2 — Core alignment (2026-10-03)

Implements `docs/PHASE-2-MIGRATION-SPEC.md` with the recommended decisions:
**D1** "Accept" is a timestamp, not a state · **D2** order updates still send after STOP (only reminders stop) ·
**D3** STOP applies to every shop · **D4** unpaid expiry is a per-shop setting (1–72 h, default 24) ·
**D5** old columns dropped one release after a clean week.

PayMongo stays **on hold** (business + BIR registration first). Paid plan upgrades show "coming soon"
until `NEXT_PUBLIC_PLAN_BILLING_ENABLED=true`.

## Deploy checklist

1. **Neon branch snapshot**, then `pnpm --filter @gumakart/db migrate` → applies **0021** (additive) and **0022** (back-fill).
2. Run `packages/db/drizzle-pending/phase2-verify.sql` — V1–V5 must all return **0 rows**.
3. Deploy admin + web + platform (this commit). Old `status`/`payment_status` columns are still written
   (dual-write), so rolling back to the previous build is safe.
4. Crons (admin, `Authorization: Bearer $CRON_SECRET`):
   - `/api/cron/outbox` — **every minute** where possible (Cloudflare Cron Trigger / Vercel Pro). `vercel.json` has a
     daily safety run because Vercel Hobby only allows daily crons.
   - `/api/cron/expire-orders` — hourly if possible (daily in `vercel.json`).
5. Smoke test on production: one COD order, one manual GCash order (send proof → confirm), book/assign a rider,
   deliver, cancel one unpaid order.
6. Run `phase2-verify.sql` daily for a week. When clean, move `drizzle-pending/0030_phase2_constrain.sql` into
   `drizzle/` (journal idx 30) and migrate. Dropping the old columns comes in a later release.

Env: `NEXT_PUBLIC_PLAN_BILLING_ENABLED=false` (new). Without `INNGEST_EVENT_KEY` the relay marks events published
and keeps them as the order event log — nothing consumes them until Phase 4.

## What changed

### Order model (three statuses)
- `orders.order_state` (open/completed/cancelled), `payment_state` (unpaid, pending_verification, paid, cod_due, failed,
  refunded, partially_refunded), `fulfillment_state` (unfulfilled, ready, booked, picked_up, out_for_delivery,
  delivered, failed_delivery, returned), plus `accepted_at`, `cancelled_at`, `cancel_reason`, `location_id`.
- **Rules live in one pure module**, `packages/db/src/queries/order-state.ts` (`planOrderAction`). Each source
  can only do its own actions: buyer = send proof; gateway = confirm payment; courier = delivery updates;
  system = expire; seller = the rest. Courier/gateway replays are no-ops, never errors.
- **One service applies them**, `order-lifecycle.ts` (`applyOrderAction`): row lock → rules → three states + legacy
  columns → payment row → restock (once) → history (`event`, `from_state`, `to_state`) → outbox event, all in one
  transaction; wallet effects after commit. Refunds still go through `refundOrder` (NOWAIT lock, gateway once).
- Paid + delivered ⇒ **completed** automatically. COD becomes paid on delivery. A payment that arrives after a
  cancel is recorded (so **Refund** appears) but never reopens the order.

### Seller (admin)
- Orders tabs: **To pay · To confirm · To pack · To ship · Shipping · Needs attention · Done · Cancelled**.
- Buttons follow the state: Confirm payment / **Not received** (reject proof) / Mark packed / Book courier /
  Assign rider / Out for delivery / Mark delivered / **Delivery failed** / **Item is back** / Cancel / Refund.
  "Cash received" for COD pickups.
- Booking a rider requires paid or COD. A booking cancelled by the courier puts the order back in **To ship**.
- Settings → Payments: **Cancel unpaid orders after N hours** (D4).
- Settings → Subscription: paid plans "coming soon".

### Buyer
- Order page timeline: Placed → Payment confirmed → Packed → Rider booked → Out for delivery → Delivered
  (pickup: Ready for pickup → Picked up). Shows "Checking your payment" and "problem with the delivery" states.
- Checkout: unticked **"Text me reminders about this order"** consent (stored on the customer and checkout session).

### Couriers
- Lalamove / Grab / BayanGo statuses map onto fulfillment (`services/src/delivery/courier-status.ts`,
  `BAYANGO_STATUS_TO_FULFILLMENT`): booked, picked up, out for delivery, delivered, failed, returned; a courier cancel
  → back to "ready". Forward-only.

### Data
- `locations` (one default per shop, seeded from the delivery pickup address); orders, stock movements and deliveries
  point at it. Stock stays on the variant (multi-location is V1.1).
- Every order has exactly one live charge row: COD at creation, manual at checkout, PayMongo at checkout.
  New columns: reference, proof_url, verified_by/at, checkout_url, refund_id, refunded_at, failure_reason.
- **Outbox**: `domain_events` gains published_at / attempts / next_attempt_at / last_error; order events are written in
  the transaction and relayed by `/api/cron/outbox` (backoff 1m → 5m → 30m → 2h, stops after 10).
- **message_log**: every SMS goes through `sendWithLog()` — idempotent per `recipe:order:step`, records
  provider id / failures / segments, and skips opted-out numbers for marketing messages.
  `messaging_opt_outs` holds STOPs (platform-wide by default).
- Platform: orders list shows order / payment / delivery states; GMV counts `payment_state = paid`.

## Tests
- `order-state.test.ts`: **exhaustive** — every valid state × every action × every source (>10,000 cases) keeps the
  invariants; terminal orders never reopen; courier events never error; happy paths and buckets.
- `phase2.test.ts` (local Postgres): 0022 back-fill on 13 legacy shapes (incl. idempotent re-run and legacy
  round-trip), outbox commit/rollback/relay/backoff, one live charge per order, per-shop expiry.
- Phase 1 lifecycle tests ported to actions (cancel race, refund NOWAIT, expiry, late payment, COD, tokens, KYC).
- db: integration 22/22, unit 36/36 · services 46/46 · typecheck clean: db, services, auth, admin, web, platform.
- `phase2-verify.sql` returns 0 rows locally; 0023 dry-runs cleanly.

## Not in Phase 2
Checkout Links (Phase 3), SMS recipes and the STOP inbound handler (Phase 4), POS (Phase 5), per-location stock,
partial refunds, merchant UI for stock history and message log (APIs/queries exist).

---

## Pre-deploy follow-ups (2026-10-03)

### STOP / opt-out
Semaphore only **sends**: buyers can't reply STOP to a sender name, so "reply STOP" could never work.
- Every reminder (marketing) SMS must carry a signed **"Stop reminders" link** (`withOptOutFooter()` in
  `@gumakart/services`); `sendWithLog()` **refuses** a marketing SMS without it. Order updates don't need it (D2).
- `kart.guma.one/stop/<token>` shows the masked number and a **Stop reminders** button (a POST, so SMS link
  previews can't unsubscribe anyone). It opts the number out of reminders from every shop (D3).
- Platform → **SMS & opt-outs**: add an opt-out for buyers who ask by chat/call ("reminders only" or "all texts"),
  remove one, and see recent/failed texts (numbers masked). Audited.
- Checkout consent copy now says each reminder has a link to stop them. `stop` is a reserved shop slug.
- Env: `SMS_OPT_OUT_SECRET` (≥32 chars; falls back to `STOREFRONT_PREVIEW_SECRET` / `AUTH_SECRET`) on web.

### Lalamove webhook check
- The verifier accepts the documented layout and the readings Lalamove's guide leaves open (exact `data` bytes vs
  re-serialized JSON; path with/without a trailing slash) — every one still needs the API secret — and logs
  **which one matched**.
- `pnpm --filter @gumakart/services lalamove:check -- https://<web host>/api/webhooks/lalamove` (sandbox keys in
  `.env`): registers the webhook, books a sandbox delivery, cancels it to trigger a webhook. Refuses to run unless
  `LALAMOVE_ENV=sandbox`.
- Then read the web logs: `Lalamove webhook signature verified {variant}` → set `LALAMOVE_WEBHOOK_VARIANT` to it.
  `Invalid Lalamove webhook signature` → share the log line.

### Tests
db integration 26/26 (adds message log: once-only sends, failures recorded, reminder without link refused,
STOP blocks reminders not updates, "all" blocks both) · services 50/50 (opt-out token, Lalamove variants and
raw-value extraction) · typecheck clean.
