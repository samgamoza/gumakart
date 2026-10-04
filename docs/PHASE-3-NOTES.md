# Phase 3 — Checkout Links (in progress)

Plan: `docs/GUMA-KART-V1-PLAN-REVISED.md` §5. Built in slices; each slice ends at an owner gate
(screenshots → approve / change / pause) before it is committed and pushed.

| Slice | Scope | Status |
|---|---|---|
| 3A | Seller side: table, admin page, create / copy / share / QR / turn off | ✅ approved 2026-10-04 |
| 3B | Buyer checkout at `kart.guma.one/c/<code>` (from the `/kart` designs), real orders, `source_channel = checkout_link` | next |
| 3C | Order page + "Back to chat", abandonment capture, share kit | — |

## 3A — what shipped

**Data (migration `0024_checkout_links`, additive)**
- `checkout_links`: `code` (7 chars, no 0/o/1/l/i, globally unique), `title` (seller-only name),
  `share_channel` (facebook / instagram / tiktok / messenger / other), `allow_quantity_edit`,
  `delivery_mode` (both / delivery / pickup), `payment_methods` (subset of the shop's; `null` = all),
  `coupon_code`, `expires_at`, `max_orders`, `active`, counters `view_count` / `start_count` / `order_count`.
- `checkout_link_items`: product + variant (the same default variant checkout charges) + quantity.
- `orders.checkout_link_id` (nullable, `ON DELETE SET NULL`).
- Prices are never stored on a link; checkout reads the variant price at order time.
- The pending Phase 2 constraint SQL is now `drizzle-pending/0025_phase2_constrain.sql` (journal idx 25).

**Rules** (`packages/db/src/queries/checkout-links.ts`)
- Only the shop's own **active** products; duplicates merged; 1–10 products; qty 1–99.
- Payment methods filtered to what the shop accepts (`isPaymentMethodEnabled`); QR Ph / card only in
  PayMongo mode. Delivery always offered (same as the storefront); pickup only if the shop enabled it.
- Items, delivery and payment choices can't be edited after creation (a shared link never changes its
  offer) — make a new link instead. Name, on/off, end date and max orders can change.
- Status: live / off / expired ("Ended") / sold_out ("Order limit reached").

**Admin**
- `/checkout-links` (nav: Commerce → Checkout links, first item), `GET/POST /api/checkout-links`,
  `GET/PATCH /api/checkout-links/:id` (strict schema; tenant-scoped).
- Create panel: products → where you'll share it → delivery → payment → more options.
  Warns when GCash/Maya is on but no number is saved.
- After create: copy link, Share… (phone share sheet), Facebook, Messenger / Viber (phones), WhatsApp,
  QR (SVG + 1024px PNG download), ready-made caption (product names, never the private link name).
- Products page: **Checkout link** button on active products → opens the panel with it picked.
- Phone layout fix for the whole admin: the sidebar is a slide-in drawer behind a **Menu** button
  below `lg` (it used to sit beside the page and push content off-screen).

**Tests:** `src/checkout-links.test.ts` (in `test:integration`, local Postgres only) — codes, shop
options, create rules, payment subset, status, tenant isolation. db unit 36/36, integration 35/35;
typecheck clean for db, auth, services, admin, web, platform.

**Deploy:** run the Neon migrate (0024) **before** pushing — the admin page reads the new table.
The link's **Open** button 404s until 3B ships the buyer page.
