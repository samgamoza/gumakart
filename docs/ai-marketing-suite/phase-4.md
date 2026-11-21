# Phase 4 — Buyer segments, payday & restock broadcasts, BayanGo review loop

Migration: `packages/db/drizzle/0050_ai_suite_growth.sql`. It also contains a Phase 3 fix: `social_accounts.platform` now allows `whatsapp`.

## Jobs (admin Worker, one every-minute cron trigger)
| Route | When | What |
|---|---|---|
| `/api/cron/segments` | 18:45 UTC (02:45 Manila) | `refresh_buyer_crm_segments(tenant_id)` per active shop |
| `/api/cron/payday-alerts` | 01:05 UTC (09:05 Manila), acts on the 14th / 29th only | Push "Payday bukas!" to Pro Live / Enterprise Vibe sellers |
| `/api/cron/broadcasts` | odd minutes | Sends due broadcasts at ≤ 10 msg/s |
| `/api/cron/review-loop` | :x3 / :x8 | Sends review asks due (2 h after delivery); expires asks after 7 days |

## Segments
Buyer = phone number (last 10 digits). Cancelled, voided, failed and refunded orders don't count.

| Tag | Rule |
|---|---|
| `VIP_REPEAT` | 3 or more orders |
| `PAYDAY_SHOPPER` | at least half of their orders placed on the 13th–17th or 28th–31st (Manila) |
| `INACTIVE_60D` | last order 60+ days ago |

## Broadcasts (`/campaigns/broadcasts`, Pro Live / Enterprise Vibe)
1. **Compose:**
   * kind: payday, restock (pick the product) or custom;
   * channel: a connected Messenger, Instagram or WhatsApp account;
   * segments (none = all buyers);
   * message with `{name}` `{item}` `{link}` `{shop}`.
   "Polish in Taglish (AI)" makes one Qwen3 call (GPU first, cloud fallback, 30 a day). Placeholders are kept, and invented stock / sold / free-shipping claims are removed. The seller sees and edits the result.
2. **Preview:** shows who can be reached now and why the others can't.
3. **Send / queue:** recipients are frozen into `broadcast_recipients` with a mode:

| Channel | Buyer messaged < 24 h ago | Otherwise |
|---|---|---|
| Messenger / Instagram | free-form message | **skipped** (Meta allows no promotional message tags) |
| WhatsApp | free-form message | approved **Marketing template** (`{{1}}` first name, `{{2}}` link), only if the buyer wrote to the number before or opted in to marketing; otherwise skipped |

Opt-outs (`messaging_opt_outs`, channel = campaign channel or `all`) are skipped.

The cron sends paced at the campaign's `rate_limit_per_sec` (capped at 10). Each free-form message goes through the inbox send path, which re-checks the 24 h window. It stops when the campaign is cancelled, or when the shop's plan no longer includes broadcasts.

**Links:**
* payday / custom → `kart.guma.one/{shop}/reorder/{lastOrderId}?ref=<channel>`;
* restock → the product page.

The reorder route makes (or reuses) a 7-day checkout link with the order's still-for-sale items. Stock is checked again at checkout, and no buyer details are copied.

## BayanGo review loop
1. BayanGo calls `POST https://kart.guma.one/api/webhooks/bayango/status` with `X-BayanGo-Signature` / `X-BayanGo-Timestamp` (HMAC with `BAYANGO_WEBHOOK_SECRET`). `delivery.completed`, or a status change to `delivered`, schedules `review_prompts.due_at = delivered + 2 h`, once per order.
2. The review-loop cron finds the buyer's chat: the order's thread, then the checkout link's thread, then a thread linked to the customer, then a WhatsApp thread matched by phone. It sends the ask:
   * inside 24 h: free-form;
   * WhatsApp outside 24 h: the approved Utility template from `ai_suite_settings.wa_review_template` (`{{1}}` name, `{{2}}` shop, `{{3}}` review link);
   * Messenger / IG outside 24 h: skipped (the existing SMS review-request recipe still applies).
3. The buyer replies:
   * **Rating found** (`5`, `5 stars`, `4/5`, `⭐⭐⭐⭐`, `lima po`, `10/10`…): a verified review is published for each item on the delivered order (the existing `product_reviews` rule: one per item, delivered orders only). A **single-use** voucher is issued as a `gift_cards` row with `single_use = true` (₱50, valid 30 days by default; the seller sets amount, days or 0 = none). The thank-you message with the code is sent.
   * **Photo only:** it is re-hosted (Meta CDN only, ≤ 8 MB, magic-byte checked) and kept until the stars arrive.
   * **Anything else:** goes to the AI closer as usual.
4. **Single-use:** the first order spends the voucher. Any remainder is forfeited (an `adjust` transaction). Cancelling that order restores what it took.

## WhatsApp templates to create in WhatsApp Manager
| Name (example) | Category | Body |
|---|---|---|
| `payday_reorder` | Marketing | `Hi {{1}}! Payday na 🎉 Order ulit ng favorite mo, one tap lang: {{2}}` |
| `order_review_request` | Utility | `Hi {{1}}! Na-deliver na ang order mo from {{2}}. Paki-rate kami (1–5 ⭐): {{3}}` |
