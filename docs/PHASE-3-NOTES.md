# Phase 3 — Checkout Links (in progress)

Plan: `docs/GUMA-KART-V1-PLAN-REVISED.md` §5. Built in slices; each slice ends at an owner gate
(screenshots → approve / change / pause) before it is committed and pushed.

| Slice | Scope | Status |
|---|---|---|
| 3A | Seller side: table, admin page, create / copy / share / QR / turn off | ✅ approved 2026-10-04 |
| 3B | Buyer checkout at `kart.guma.one/c/<code>` (from the `/kart` designs), real orders, `source_channel = checkout_link` | ✅ approved 2026-10-04 (Taglish) |
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

## 3B — what shipped

**Buyer page** `apps/web/app/c/[code]` (Taglish, one page, phone-first, seller's name on top)
- Order review (photo, price, quantity stepper if the link allows it, capped by stock) → your details
  (name, mobile) → delivery or pickup (PSGC Region → Province → City → Barangay + street/landmark,
  or the shop's pickup address) → payment cards (only methods the shop accepts **and** the link
  allows) → unticked SMS-reminder consent → fee breakdown above the button → sticky total + button.
- Delivery fee is the same as the order will charge: `/api/delivery/quote` now takes city /
  barangay / province so the fallback uses the same zones as checkout. Totals use
  `computeCheckoutTotals` (coupon on the link, tax, discounts) on the client and server.
- Link previews: OG title "Product · Shop", the product photo, `noindex`.
- Closed links (off / ended / order limit / product unpublished / shop not live) show a friendly page.
- After ordering → the existing order page (pay instructions + receipt upload). Restyled in 3C.

**Server**
- `apps/web/lib/place-order.ts`: the storefront checkout pipeline moved here unchanged and is now
  used by both `/api/checkout` and `/api/c/<code>/order` (one checkout implementation).
- `/api/c/<code>/order`: the link decides products and quantities (buyer quantities only if allowed,
  unknown products ignored), payment and delivery options; 10/min/IP.
- `/api/c/<code>/session`: progress save once a valid mobile is typed; first save = "started checkout".
- `createOrderForTenant`: `checkoutLinkId` + `utmJson`. Claims one order from the link **inside the
  order transaction** (`UPDATE … WHERE active AND not expired AND order_count < max_orders`), so the
  order limit can't be overshot by simultaneous buyers; refused → `LINK_CLOSED`.
- Views counted server-side, skipping link-preview bots (Messenger, WhatsApp, Viber…).
- UTM / fbclid / ttclid from the link URL saved on the session and the order.
- `upsertCheckoutSession` is now race-safe (two saves at once used to hit the unique key).
- Creating a checkout link activates a pending shop (plan §9).

**Seller**
- Orders show a tag: "Checkout link · <link name> (<where shared>)".
- Link stats (views / started / orders / sales) fill in from real activity.

**Tests:** checkout-links suite 12/12 (adds: order records link + UTM and is counted; 4 simultaneous
buyers on a 2-order link → exactly 2 succeed; turned-off link refuses and leaves no order behind).
db unit 36/36, integration 38/38, services 50/50, typecheck clean. Manual: storefront cart checkout
still works (regression), tampered quantities ignored, wrong code 404, short address 400.

**Deploy:** no migration. Push only.

**Known limits:** the order limit counts cancelled orders too; a product with several variants is
sold as its default variant (same as the storefront today).

## Onboarding (plan §9, brought forward from Phase 6) — approved 2026-10-04

4 steps to a shareable link; the Launch wizard (store look) is optional and no longer forced.
1. **Your business** (signup, email or Google): shop name, mobile, category, "Where do you sell now?"
   (Facebook / Messenger / Instagram / TikTok / Shopee / Lazada / Other), optional page/chat link
   (stored for 3C "Back to chat"). Shop URL generated from the name (`findAvailableShopSlug`, "-2"…).
   No vibe/theme question.
2. **First product** (`/onboarding`): photo, name, price, stock — or pick an existing product.
3. **How you get paid**: GCash and/or Maya number + name, COD on/off. Writes the published + draft
   checkout so each method is on only when usable (GCash/Maya need a number). Brand-new shops get
   no minimum order (old default ₱99 would block a ₱50 link).
4. **Your link is ready**: creates the checkout link (share channel = first social picked), copy /
   share / QR, then the dashboard.
- "I'll finish this later" on every step. Progress in `settings_json.onboarding`
  (`step`, `completedAt`, `skippedAt`); `needsOnboarding` = not finished/skipped and no checkout link.
- Home routing: `/` and `resolveSellerHomePath` → `/onboarding` while needed, else `/`. Existing
  sellers without a link see it once (owner approved).
- Queries: `packages/db/src/queries/onboarding.ts`. APIs: `/api/onboarding/state|payments|finish`.
- Not yet: AI product description in step 2, dashboard redesign (§10), Taglish for seller screens.

## Dashboard + navigation (plan §10)

- Overview = "What needs you today": tiles for Payments to confirm · To pack · To book delivery ·
  Delivery problems (each opens `/orders?tab=…`), "N waiting for the buyer to pay", Today (sales,
  orders, checkout links vs online store, Manila day), Deliveries (booked, out for delivery,
  delivered today), newest checkout link with copy, setup checklist for the new flow (product,
  payments, first link, email; online store optional), shortcuts. `getSellerToday` +
  `/api/dashboard/today`. The old "Change template / Order Now link / PayMongo / categories" card is gone.
- Menu: Overview · SELL (Checkout links, Orders, Products, Categories, Customers) · FULFILL
  (Deliveries → Orders "Shipping") · AUTOMATE (Messages) · STORE (Online store) · Marketing & AI
  (collapsed) · Settings (Business, Payments, Delivery, Notifications, Plan, …). Removed the
  placeholder pages (Users, Analytics, Integrations, Domains, Workflows, Code, Logs, API, Security);
  wallet/KYC hidden from the settings menu (payouts are simulated in V1).
