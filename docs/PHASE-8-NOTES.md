# Phase 8 — Launch-ready V1

Roadmap: project doc `claude/gumakart-roadmap.md`. Providers stay in a ready-to-hook-up state
until the owner has the registrations: see `docs/GO-LIVE.md` (Semaphore, Resend, PayMongo, Meta,
BIR) — exact secrets, which Workers, and how to test each one.

## What shipped
- **Ops → Metrics** (`/metrics`, 7/30/90 days): plan §14 numbers computed live —
  activation (new shops → product → link → first order, median time to first order), conversion
  (link views → checkout starts → link orders, median payment-confirm time, recovered checkouts),
  fulfilment (booked in Guma, delivery success, paid → delivered), messaging (sent / failed /
  suppressed / opt-outs), retention (shops with orders in 7/30 days, repeat buyers), sales by
  channel and orders per week. Query: `packages/db/src/queries/platform-metrics.ts`.
- **Template photos fix**: storefront heroes use the shop's cover photo, else **the shop's own
  product photo**, before any template stock image (a skincare shop on a fashion template no
  longer gets a clothing banner). Launch category previews added for Beauty & Skincare, Catering,
  Shoes, Grocery, Organic, Pet, Furniture, Hotels (reusing curated photos — no cross-industry
  fallbacks).
- **Semaphore sender name**: optional `SEMAPHORE_SENDER_NAME` is sent when set; shows in the
  integrations report.
