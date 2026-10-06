# Guma Kart — Polish roadmap (Phase 21 onward)

Written 2026-10-06, after Phase 21. This is the **parking lot** for work after the original roadmap
(`claude/gumakart-roadmap.md`, phases 8–15 plus the operations track). That roadmap is fully built
(phases 8–20). Nothing below blocks launch. Pick from here when real sellers show what they need.

**Same working rule:**

- One phase at a time, with one review gate per phase (screenshots, then approve, change or pause).
- Sam pushes and runs the Neon migrations.
- Semaphore, PayMongo, Meta, Shopee/Lazada and BIR stay "ready to hook up" until the registrations
  exist.

**How to choose the next phase.** Use the north star from the original roadmap: *does this make
selling through chat easier, faster, or more trusted?* Before building, run the beta (below) and let
seller requests reorder this list.

**Before starting any phase:** re-check the code for what already exists. The "Exists today" lines
were verified on 2026-10-06 and can go stale.

---

## Where things stand

| Phase | What | Status |
|---|---|---|
| 8–15 | Original roadmap: launch readiness, variants and stock, staff, after-sale and BIR-ready POS, Guma ID, channels, reports and growth, platform | Built and approved |
| 16 | Operations: monitoring, status page, billing lifecycle, backups | Approved |
| 17 / 17b | Seller polish: deals at the POS, gift cards, branch stock, free-delivery nudge, remembered buyer | Approved |
| 18 | Agency partners (no commission) + API v1.1 | Approved |
| 19 | Go-live hardening: forgot password, route audit, schema guard, smoke suite | Approved |
| 20 | Storefront speed (images, fonts, code split) | Approved (LIVE badge: leave as is) |
| 21 | Two-step sign-in (required for ops, optional for sellers), Change password, last theme images | Live (deploy #20, `df6d24c`) |
| **21b** | **Third homepage "Palenke AI" (ops → Frontends), seller dashboard installable as an app** | **Built, in review** |

## The launch track (not code: Sam's to-dos)

This comes before any polish phase. It is the roadmap's real finish line: **10 merchants with a paid
order in week 1, and no P1 bugs open for 2 weeks.**

1. Run `pnpm db:status` against Neon, then migrate 0032 → 0037. Push.
2. Every ops admin signs in once and sets up an authenticator app (Phase 21).
3. Add the provider keys:
   - Semaphore (`SEMAPHORE_API_KEY`, `SMS_OPT_OUT_SECRET`)
   - Resend
   - PayMongo live, plus `NEXT_PUBLIC_PLAN_BILLING_ENABLED=true`
   - `GUMA_ID_SECRET`
4. Meta app review (needed for Messenger/IG and for Phase 25). Shopee/Lazada partner keys.
5. Have an accountant review BIR numbering before any shop turns it on.
6. Reset the Neon password. Run the first restore drill (`docs/RUNBOOK-BACKUPS.md`).
7. Beta: 10–20 merchants, including at least one provincial shop and three with a physical store on
   the POS. Run the smoke suite (`e2e/`) against the live site with a test shop first.
8. After deploy, run PageSpeed Insights on a live shop and a checkout link to confirm the Phase 20
   gains.

---

## Polish phases

Sizes assume the current pace: **S** is about one phase session, **M** about two, **L** three or more.
"Needs" lists what must happen outside the code first.

### Phase 22 — Buyer demand capture (M) · *recommended first*

**Why.** Sold-out items and "pa-reserve po" messages are lost sales today. Other social-selling
apps capture this demand.

**Exists today:** stock, low-stock alerts, Guma ID, SMS/email outbox. **Doesn't exist:** a "Notify me"
button (only a demo button in `v0-store/live-selling`), wishlists, pre-orders.

**Scope:**

- **Back-in-stock alerts.** A "Notify me" button on a sold-out product or variant collects a phone or
  email, with consent. When stock goes from 0 to above 0, buyers are notified in order, through the
  outbox, respecting quiet hours. The seller sees a count like "12 waiting" in Inventory, plus a
  reorder hint.
- **Wishlist / favorites.** Saved to Guma ID, or to the device if the buyer isn't signed in. Sellers
  see the most-saved items. No invented counts are ever shown to buyers.
- **Pre-orders.** A per-product toggle with an expected ship date and an optional deposit (fixed or %).
  The order shows "Pre-order — ships ~Nov 15". The balance is due on arrival. Pre-orders stay out of
  available stock and draw from incoming stock instead.

**Data:** new `stock_alerts` and `wishlist_items` tables; pre-order fields on products and orders.

**Needs:** Semaphore and/or Resend for the notifications. Without them, the seller sees the list and
messages buyers manually.

### Phase 23 — Trust and social proof (M)

**Why.** Chat buyers ask "legit ba?". Real reviews from real orders answer that, and fit our rule
against invented numbers.

**Exists today:** nothing for product reviews or ratings.

**Scope:**

- **Reviews only from completed orders.** The order page and SMS ask "Kumusta ang order mo?", with
  stars, text and up to 3 photos (using the existing browser shrink and R2).
- **Seller moderation:** reply, hide (with a reason), report. No editing a buyer's words.
- **Storefront display:** stars on product cards and product pages, a photo-review strip, and a shop
  rating. "Verified buyer" is always true by construction.
- **Q&A on the product page** (optional slice).
- **Ops moderation queue** for reported reviews (the moderation page exists in ops).

**Data:** a `product_reviews` table, with one review per order item.

### Phase 24 — Faster fulfilment (M–L)

**Why.** Packing 50 orders after a live sale is where sellers lose a night.

**Exists today:**

- Courier booking: BayanGo and Grab, plus delivery quotes.
- Packing slips, and barcode fields on variants.

**Doesn't exist:** waybill or barcode-label printing, batch packing, pick lists. (Barcode label
printing was in roadmap Phase 11 but wasn't built.)

**Scope:**

- **Batch actions:** select orders → print packing slips and pick list (grouped by product/variant)
  → mark packed.
- **Barcode/price labels** for products and variants (thermal 40×30 mm and A4 sheets), plus POS scan
  to add.
- **Courier waybills:** J&T, LBC, Flash and Ninja Van, through an aggregator if one fits. Book and
  print the waybill, with tracking numbers sent to buyers.
- **A shipping-fee table by region** for sellers who don't use live quotes.

**Needs:** courier or aggregator API accounts (another "ready to hook up").

### Phase 25 — Live selling, for real (L)

**Why.** "Mine!" selling on Facebook/TikTok Live is the PH social-commerce habit. The classic
theme's LIVE card was kept on purpose (2026-10-06); this phase gives it something real behind it.

**Exists today:** the LIVE badge/card in the classic theme (decorative), Messenger inbox, checkout
links.

**Scope:**

- **Live session:** the seller picks items with a code each (e.g. "B12") and goes live on FB/TikTok
  outside Guma.
- **Comment claims:** "mine B12" comments are captured (Meta webhooks once approved; manual entry
  until then). Each claim reserves stock in queue order.
- **Claims → orders:** each buyer gets one combined checkout link by Messenger or SMS. Unpaid claims
  expire and roll to the next in line.
- **Storefront card:** "Live now on Facebook" links to the actual stream. Viewer numbers never come
  from us.
- **After-live report:** claims, paid, expired, revenue.

**Needs:** Meta app review (page comments permission). TikTok has no comparable open API yet, so its
claims start manual.

### Phase 26 — AI seller assistant (M)

**Why.** Most sellers write listings and captions on their phone between orders.

**Exists today:** the `@gumakart/ai` package (Template Intel and Gemini/OpenAI/Groq keys).

**Scope:**

- Taglish product title and description from a photo and a few words, with the seller editing before
  saving.
- Caption writer for FB/IG/TikTok posts with the checkout link, and a "share post" image (one exists
  for links).
- Suggested replies in the Messenger inbox for common questions (price, stock, shipping). Nothing is
  sent without the seller.
- Optional: clean up a photo background (only if a provider is cheap enough per image).

**Needs:** AI provider keys and a per-plan monthly usage cap.

### Phase 27 — Repeat buyers: loyalty and referrals (M)

**Why.** Store credit and gift cards exist; a simple loyalty layer turns them into repeat orders.

**Exists today:** store credit, gift cards, customer segments, SMS campaigns, Guma ID.

**Scope:**

- **Stamp card or points per shop**, configured by the seller (e.g. "every ₱1,000 = 10 pts"; 100 pts =
  ₱50 credit). Paid out as store credit, so no new money rails are needed.
- **Buyer referral codes:** "Give ₱50, get ₱50" as store credit after the friend's first paid order,
  with fraud limits (same phone or address can't refer itself).
- **Balance on the order page and in Guma ID.**

**Data:** a loyalty ledger. Reuse the store-credit ledger patterns.

### Phase 28 — Account security v2 (S–M)

**Why.** These are the Phase 21 follow-ups.

**Scope:**

- **Plan or shop setting:** require two-step sign-in for owners and managers (optional per shop;
  default on for shops above a sales threshold).
- **New-device sign-in email,** plus a list of signed-in devices with "sign out this device". Today
  there's only "sign out other devices".
- **Passkeys (WebAuthn)** as a second factor, or as passwordless sign-in.
- **Ops:** see each admin's 2FA status, and an audited "reset 2FA" button. Today this is SQL
  (`docs/PHASE-21-NOTES.md`).

**Data:** a `user_sessions` table (needed for per-device lists) and a `passkeys` table.

### Phase 29 — Partner economics (S–M) · *waits on Sam's decision*

**Why.** Referral data has been collected since Phase 18; commission and payouts were deferred
("No commission yet", "Payout: decide later").

**Scope:**

- Commission model (e.g. % of the shop's plan fee for 12 months).
- Monthly partner statements.
- Payout export (GCash/bank, done manually by ops at first).
- Partner reports per client shop.

**Needs:** Sam's commission and payout decisions, and an accountant's view on how payouts are
recorded.

### Phase 30 — Reach more buyers (S each, pick any)

- **Buyer-facing Cebuano/Bisaya** alongside Taglish: checkout, order page, SMS.
- **Bundles and "buy together"** on the product page. Bundle discounts exist in Discounts; this adds
  the storefront presentation.
- **Subscriptions / repeat orders** (e.g. weekly ulam, monthly coffee): reminder SMS with a
  one-tap reorder link.
- **Shop QR standee generator** for physical stores (print-ready PDF).

---

## Engineering backlog (fit into any phase, ~20%)

These are the follow-ups gathered from the Phase 18–21 notes.

| Item | From | Why |
|---|---|---|
| Run the smoke suite in CI against a staging test shop | Phase 19 | It runs only locally today |
| Job runner (Cloudflare Queues) instead of the every-minute cron relay | Roadmap ops track | The free plan allows one cron; queues scale better |
| Trim ~46 KB of shared CSS (mostly Tailwind) | Phase 20 | Storefront first paint |
| Watch Cloudflare image transformations against the 5k free tier | Phase 20 | Seller uploads fall back to originals; check what `/_next/image` does on overflow |
| Load test before the first big SMS campaign or live sale | Roadmap ops track | Every-minute cron, outbox, Neon connection limits |
| External uptime monitor on `kart.guma.one/api/status` | Phase 16 | Free UptimeRobot |
| Rotate `AUTH_SECRET` only together with a 2FA reset | Phase 21 | It keys the stored authenticator secrets |
| Move `drizzle-pending/0038_phase2_constrain.sql` into the journal after a clean week of `phase2-verify.sql` | Phase 2 | Renumber it whenever a phase adds a migration |
| Self-serve ops password reset (deliberately absent) | Phase 19 | Revisit only together with Phase 28's ops 2FA reset |

## Not planned (on purpose)

These are deliberate scope cuts from the original roadmap, and they stay cut unless the market says
otherwise:

- a theme marketplace or app store
- multi-currency or international shipping
- B2B/wholesale
- headless storefront APIs

SMS codes as a second factor are also out: SIM-swap risk, and SMS is the Guma ID channel.
