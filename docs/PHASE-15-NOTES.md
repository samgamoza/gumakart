# Phase 15 — Platform: public API, webhooks, apps & integrations

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 15). Migration **0033_platform** must run
on Neon **before pushing** (`pnpm --filter @gumakart/db migrate`). It adds `api_tokens`,
`webhook_endpoints`, `webhook_events`, `webhook_deliveries`, and three triggers (`orders`,
`product_variants.stock_qty`, `customers`) that write webhook events in the same transaction as the
change. The triggers do nothing for shops without an active webhook. Pending Phase 2 constraints are
now `drizzle-pending/0034_…` (journal idx 34). There are no new packages and no new secrets:

- Webhook signing secrets are sealed with the existing token box (`CHANNEL_TOKEN_KEY`, else
  `AUTH_SECRET`).
- The API rate limit uses Upstash when `UPSTASH_REDIS_REST_*` is set, otherwise per-instance memory
  (best effort).

## What shipped

### API keys (`/developers`, owner only — new permission `developers.manage`)

- Keys are `gk_live_…`, shown once. Only the SHA-256 is stored.
- Each key has a name, scopes, an optional expiry (30/90/365 days), "last used" and revoke.
- Up to 20 active keys per shop.
- Scopes: `orders:read`, `orders:write`, `products:read`, `inventory:read`, `inventory:write`,
  `customers:read`. A write scope includes its read scope.
- Creating and revoking keys is in the activity log.

### Public REST API (`https://admin.guma.one/api/v1`)

- Bearer key auth only (never cookies). 120 requests per minute per key. `Cache-Control: no-store`.
- Endpoints:
  - `GET /shop`
  - `GET /orders` (filters: states, channel, created range; cursor paging)
  - `GET /orders/{id|number}`
  - `POST /orders/{id}/actions` (accept, mark_ready, out_for_delivery, delivered, failed_delivery,
    returned)
  - `GET /products`, `GET /products/{id}`
  - `GET /inventory` (sku/barcode)
  - `PUT /inventory` (set counted stock by variant_id or SKU, up to 500, all or nothing)
  - `GET /customers` (phone filter), `GET /customers/{id}`
- `GET /api/v1/openapi.json` is public and describes the whole API (OpenAPI 3.1).
- Money is a 2-decimal string in PHP. Fields are snake_case and only ever added.
- Errors are `{ error: { code, message, details? } }` with 400/401/403/404/409/429.
- Order actions go through the same `applyOrderAction` as the seller buttons, so buyers get the same
  SMS/email. Payments, cancels and refunds are deliberately **not** in the API.
- API changes show in the activity log as "API · key name".

### Webhooks

- Up to 10 endpoints per shop. Each has a URL, a label, chosen events, an on/off switch and a
  signing secret (reveal or rotate).
- URL rules: public HTTPS on port 443 only. No IPs, internal names, credentials or `guma.one`
  hosts. Local dev also allows `http://localhost`.
- Events:
  - `order.created`, `order.paid`, `order.fulfillment_updated`, `order.completed`,
    `order.cancelled` (includes POS voids), `order.refunded`
  - `inventory.updated`
  - `customer.created`
  - Plus `webhook.test` from the "Send test" button.
- Because events come from DB triggers, every path emits them: checkout, link checkout, POS,
  offline sync, Shopee/Lazada import, order actions, refunds, expiry and stock edits.
- The cron (`/api/cron/webhooks`, every 5-minute tick):
  1. Fans each event out once, freezing one payload (the API object at that moment).
  2. Sends due deliveries 10 at a time with a 5-minute lease (no double sends).
  3. Prunes events older than 30 days.
- Each delivery is signed: `Guma-Signature: t=…,v1=HMAC-SHA256("t.body")`, plus the Event,
  Event-Id, Delivery and Attempt headers.
- Delivery rules:
  - Redirects are not followed. Timeout is 10 s.
  - Retries come at 1, 5, 15 and 60 min, then 3, 6, 12 and 18 h (9 tries).
  - After 50 failures in a row the endpoint turns off and its queue is failed. It can be turned back on.
- Delivery history per endpoint shows status, code, time and error, with **Resend**.
- The Docs tab has the API reference, paging/errors/limits, the webhook body, and Node.js
  signature-check code.

### Apps & integrations (`/integrations`, settings.shop)

- One directory of what's on for this shop. Each item is marked:
  - "Ready to set up"
  - "Coming soon" (built, waiting for Guma Kart's provider accounts)
  - "Through webhooks / API"
- Groups:
  - Payments: GCash/Maya, bank, PayMongo
  - Messaging: SMS, email, Messenger/IG
  - Sales channels: Shopee, Lazada, tagged links
  - Delivery: Lalamove, Grab
  - Ads & analytics: pixels
  - Automation: Zapier/Make/n8n, Google Sheets, accounting via CSV/API, own app
- No partnership is claimed for tools that only connect through webhooks.

### Small fixes

- More peso formatters normalised: the activity log, and the web demo page.
- API order items hide a variant title that just repeats the product title.

## Honest limits

- Webhooks arrive within ~5 minutes (cron tick), not instantly. They may arrive out of order;
  receivers should use `created_at` or fetch the latest.
- No product create/edit through the API yet. Only stock and order packing/delivery steps can be
  written.
- Rate limiting is per instance unless Upstash is configured.
- **Partner program for agencies is not built.** It needs business decisions (commission, agency
  dashboard across shops). Agencies can be invited as Manager staff today.
- An app marketplace or OAuth for third-party apps is deferred until there are real partner apps.
  Keys are per shop, made by the owner.

## Tests

- db unit `types/developer.test.ts`: scopes, events, URL rules (SSRF), cursors, money, retry
  schedule.
- db integration `developer.test.ts`: keys (hash, scopes, revoke, expiry), API read models and
  paging, tenant isolation, stock by SKU all-or-nothing, triggers → events → fan-out → deliveries,
  retry/lease/resend, test events, auto-disable.
- services `webhooks/sign.test.ts`: signature, replay window, send outcomes.
