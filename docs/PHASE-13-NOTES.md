# Phase 13 — Channels

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 13). Migration **0031_channels** must run
on Neon **before pushing**. It adds `orders.sales_channel`, `external_order_id` and
`social_thread_id`, and backfills `sales_channel` from POS, click ids and link share channels. It
also creates `social_accounts`, `social_threads`, `social_messages`, `marketplace_accounts` and
`marketplace_listings`. Pending Phase 2 constraints are now `drizzle-pending/0032_…` (journal
idx 32). There are no new packages.

**Ready to hook up** (see `docs/GO-LIVE.md` §4, §4b, §4c):

- Messenger/Instagram turns on with the `META_*` keys after Meta review.
- Shopee and Lazada turn on with their partner keys.
- Email copies turn on with the existing Resend setup.

Until then each card says "Malapit na" in production. Local and dev have a **demo mode**, so you
can try every flow: a demo Page, demo Shopee/Lazada shops, simulated buyer messages and orders.
Replies there are labeled "test (not sent)".

## What shipped

### Where sales come from (all shops, works today)

- Every order now records a **sales channel**: Facebook, Instagram, Messenger, TikTok, Shopee,
  Lazada, POS or Direct. The rules come first in this order:
  1. An explicit channel: POS, a marketplace import, or an order placed from a chat.
  2. `?ref=` on the link.
  3. `utm_source`.
  4. Click ids: `ttclid` means TikTok, `igshid` means Instagram, `fbclid` means Facebook.
  5. The channel the seller picked when sharing the checkout link.
  6. Otherwise, Direct.
- The online store now remembers the buyer's `ref`/utm for that browser tab, so a store order a
  few pages later is still credited. Before this, store orders had no attribution.
- **Channels page**:
  - "Where your sales come from" shows the last 30 days by channel.
  - Shop links tagged per channel: TikTok, Facebook, Instagram, Messenger.
  - The checkout link "Share" panel has **Copy for TikTok / Facebook / Instagram / Messenger**.
- **TikTok:** the TikTok-tagged links are how a seller tracks TikTok sales today (bio and
  captions). A TikTok Shop catalog sync is not part of this phase.
- The orders list labels the source, for example "Checkout link · Payday post (TikTok) · from
  chat" or "Shopee order 2610…".

### Messenger & Instagram — Chats (ready to hook up)

- **Connect Facebook Page** (Channels) uses Facebook Login. Every Page the owner ticks is
  connected, along with its linked Instagram professional account. Each Page is then subscribed
  to the webhook. Page tokens are stored sealed (AES-GCM).
- **Webhook** `/api/webhooks/meta`:
  - The signature is checked.
  - Messages, attachments, postbacks and echoes are saved once each.
  - A new buyer's name is fetched.
  - The seller gets a push notification.
- **Chats page**:
  - Tabs: To answer / Done / All. Search, and unread counts.
  - Messenger and Instagram are mixed in one list.
  - Reply by text.
  - Send a **product card** with photo, price and an "Order na" button.
  - Send a **checkout link**.
  - Links carry `?ref=messenger|instagram&th=<chat>`, so an order placed from them is **tagged to
    that chat**. The chat shows "Orders from this chat", and the order counts under Messenger.
  - Mark done; a new buyer message reopens the chat.
- **Meta's 24-hour rule** is enforced. Replies only go out within 24 h of the buyer's last
  message, and the composer explains this.
- Staff can use Chats (`messages.reply`). Connecting channels is for owners and managers
  (`settings.shop`).
- The old "Messages" page is the AI shop assistant. Its nav description now says so.

### Shopee & Lazada — one stock count (ready to hook up)

- **Connect** uses each marketplace's own authorization page. Listings are fetched and
  **auto-linked by SKU or barcode**. Anything unmatched can be linked by hand in a table showing
  Guma stock against the marketplace count.
- **Every 5 minutes** (admin cron) and on **Sync now**:
  1. Guma stock is pushed to every linked listing whose count differs.
  2. Paid orders changed since the last pull are imported.
- **Imported orders**:
  - Recorded as completed sales with `source_channel` set to marketplace and the channel set to
    Shopee or Lazada.
  - They take stock here and never go below zero. An oversell is noted on the order and on the
    account ("Oversold … recount").
  - A cancellation or return on the marketplace puts the stock back once.
  - Unpaid orders wait.
  - Orders with unlinked items wait, and the account lists which listings to link.
- Refunds and returns for marketplace orders are blocked here, with an explanation: Shopee and
  Lazada handle them, and cancellations sync in.
- Signing follows the public APIs: Shopee v2 HMAC and Lazada HMAC. Tokens are stored sealed and
  refreshed before they expire.

### Email receipts and templates

- Buyer emails go alongside the texts: **order received, payment confirmed, rider booked / ready
  for pickup, out for delivery, delivered**.
  - They carry the full item list and totals, with a "Tingnan ang order" button. Copy is Taglish.
  - They are sent only when the buyer typed an email at checkout.
  - Each has its own message-log key, so a resend never duplicates.
  - The switch is Auto SMS → **Email copies** (on by default; free).
- The **POS** receipt screen has **Email receipt**. It includes the BIR invoice number when BIR
  numbering is on.
- The message log labels the email recipes.

### Fixes found on the way

- **Counts that always showed 0**:
  - The POS "This shift's sales" item counts.
  - The product snapshot stock in the activity log.
  - The POS product photo lookup.
- The cause: drizzle leaves column names unqualified inside `sql` subqueries. These now use
  explicit table aliases, and the new channel counts were written the same way.

## Honest limits

- None of Meta, Shopee or Lazada has been tested against the live APIs; there are no keys yet.
  The first real connection of each should be watched (GO-LIVE lists what to check).
- Meta often withholds buyer names until app review, so a chat may show "Buyer" at first.
- Stock sync runs every 5 minutes. A unit can still be sold twice inside that window if two
  channels sell the last unit at the same moment. The import then flags the oversell instead of
  hiding it.
- Marketplace orders are records of the sale and its stock. Packing and shipping stay in Shopee
  and Lazada.
- Only listings linked to a tracked product have their stock pushed.
- TikTok Shop sync and WhatsApp are not in this phase.

## Tests

- **db unit:** `sales-channel.test.ts` (4) covers attribution order, aliases and URL tagging.
- **db integration:** `channels.test.ts` (9) covers:
  - Order channel by ref, click ids and POS.
  - A Page belonging to one shop.
  - Messages recorded once, with unread counts and reopening.
  - Echo dedupe, the 24-hour window, and shop isolation.
  - Orders tagged to a chat.
  - SKU auto-link and push plan.
  - Import once / unlinked / unpaid / cancel restocks once.
  - Oversold never below zero.
  - The foreign-variant link refused.
  - Sales by channel.
- **services:** `channels.test.ts` (8) covers:
  - Meta signature and webhook parsing.
  - The product card payload.
  - Shopee and Lazada signing.
  - Token sealing and tampering.
  - Email templates (items, HTML escaping, POS e-receipt).

| Suite | Result |
|---|---|
| db unit | 72 ✓ |
| db integration | 113 ✓ |
| services | 68 ✓ |
| auth | 9 ✓ |
| admin | 9 ✓ |
| typecheck (admin, web, platform) | clean |
| production builds (admin, web, platform) | ✓ |

**Browser check:**

- Channels: sales by channel, tagged links, demo Page, demo Shopee with a simulated order.
- Chats: simulated buyer message, reply, product card, phone view.
- Auto SMS email copies.
- Orders list label for a Shopee order.
