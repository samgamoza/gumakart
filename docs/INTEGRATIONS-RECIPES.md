# Guma Kart — Zapier & Make recipes

These recipes connect a shop to Google Sheets, Slack, Telegram, accounting tools and more. They use
only the public API and webhooks. You don't need a Guma Kart app in the Zapier or Make directories:
each recipe uses their generic **Webhooks** and **HTTP** building blocks.

- **API base URL:** `https://admin.guma.one/api/v1`. The full spec is at `/api/v1/openapi.json`.
- **API key:** in the dashboard, go to **API & webhooks**, then **New key**, and pick only the scopes the recipe needs. Send it as the header `Authorization: Bearer gk_live_…`.
- **Webhooks:** in the same place, use **Add endpoint**. Paste the URL that Zapier ("Catch Hook") or Make ("Custom webhook") gives you, then tick the events you want.
  - Events arrive within about a minute.
  - Each payload is `{ id, type, created_at, shop, data: { object } }`. The `object` is the same JSON the API returns: an Order, StockRow, Customer or Product.
- **Rate limit:** 120 requests per minute per key.

> **Security.** Every webhook carries `Guma-Signature: t=<unix>,v1=<hex>`. The `v1` value is the HMAC-SHA256 of `"<t>.<raw body>"`, keyed with the endpoint's secret.
>
> Zapier and Make can't check this signature without a code step. So:
>
> - Keep the catch-hook URL private.
> - Before anything involving money, fetch the order again with `GET /orders/{id}` and act on that response.
>
> Never put an API key in a shared Zap or Scenario that other people can open.

---

## 1. Every new order → a row in Google Sheets

**Needs:** a webhook on `order.created` (no API key).

- **Zapier:**
  1. Webhooks by Zapier → **Catch Hook**.
  2. Google Sheets → **Create Spreadsheet Row**.
- **Make:**
  1. Webhooks → **Custom webhook**.
  2. Google Sheets → **Add a row**.

Useful fields:

| Field | Meaning |
|---|---|
| `data.object.number` | Order number |
| `data.object.created_at` | When it was placed |
| `data.object.buyer.name` | Buyer name |
| `data.object.buyer.phone` | Buyer phone |
| `data.object.total` | Order total |
| `data.object.payment_method` | How they're paying |
| `data.object.channel` | Facebook, TikTok, POS, … |
| `data.object.items[].title` | Item names (Make: use an Iterator, or `join()` the titles) |

## 2. Paid order → message the team (Slack, Discord, Telegram, Viber bot)

**Needs:** a webhook on `order.paid`.

Add a filter step: `data.object.channel` is not `pos` (the cashier already knows).

Example message:

`💰 {{data.object.number}} paid — ₱{{data.object.total}} by {{data.object.buyer.name}} via {{data.object.payment_method}}`

## 3. Low-stock alert

**Needs:** a webhook on `inventory.updated`.

1. Filter: `data.object.stock` is less than or equal to **3**. Optionally also filter on `data.object.sku` starting with your fast-moving prefix.
2. Send:

   `⚠️ {{data.object.product_title}} ({{data.object.title}}) — {{data.object.stock}} left`

## 4. Keep prices in a Google Sheet and push them to the shop

**Needs:** an API key with `products:write`.

1. Set up a Sheet with these columns: `variant_id` (or `sku`), `price`, `compare_at_price`.
2. Get the variant IDs once with `GET /inventory`. It returns `id`, `sku`, `product_title`, `title`, `price` and `stock`, and accepts `?limit=100` and `?cursor=`.
3. Build a **Make** scenario:
   1. Google Sheets → **Watch changes** (or a daily schedule plus **Search rows**).
   2. **HTTP → Make a request** with these settings:

      | Setting | Value |
      |---|---|
      | URL | `https://admin.guma.one/api/v1/variants/{{variant_id}}` |
      | Method | `PATCH` |
      | Header | `Authorization: Bearer gk_live_…` |
      | Body type | JSON |
      | Body | `{"price": {{price}}, "compare_at_price": {{compare_at_price or null}}}` |

4. The product's "from ₱X" price follows the cheapest variant automatically.
5. Every change shows in the shop's **Activity** log as `API · <key name>`.

`compare_at_price` must be higher than `price`; otherwise the API returns 400.

## 5. Stock counts from a Sheet (or another system)

**Needs:** an API key with `inventory:write`.

Send `PUT /inventory` with a body like this:

```json
{ "items": [ { "sku": "MUG-01", "stock": 40 }, { "variant_id": "…", "stock": 0 } ] }
```

- Up to 500 items per call.
- It's all or nothing: one bad row rejects the whole call, and the error says which row.
- The new numbers are counted stock, not deltas.

## 6. Add products from a form or Sheet (as drafts)

**Needs:** an API key with `products:write`.

Send `POST /products` with a body like this:

```json
{ "title": "Lavender Soap", "price": 120, "stock": 30, "sku": "SOAP-LAV", "description_html": "<p>…</p>", "image_url": "https://…" }
```

- New products start as **draft**. Review them in the dashboard and publish, or send `PATCH /products/{id}` with `{"status": "active"}`.
- Products with options (sizes, colours) are set up in the dashboard. After that, their variants can be priced through the API.

## 7. Daily sales summary

**Needs:** an API key with `orders:read`, on a daily schedule (Zapier Schedule or Make).

1. Call `GET /orders?created_after={{yesterday 00:00 +08:00}}&created_before={{today 00:00 +08:00}}&limit=100`. Follow `next_cursor` if it's not null.
2. Sum `total` over orders that are not cancelled.
3. Count by `channel`.
4. Send yourself the totals by email or Telegram.

## 8. New customer → CRM or mailing list

**Needs:** a webhook on `customer.created`.

Only add people with `data.object.sms_marketing = true` to marketing lists. The others gave their number for order updates only.

## 9. Product changed → update a catalog feed

**Needs:** a webhook on `product.created` and `product.updated`.

Use these events to refresh a Google Merchant Center sheet or a Facebook catalog feed you maintain yourself. `data.object` is the full product with its variants and images.

---

**What the API doesn't do (on purpose):**

- No payments, cancels or refunds.
- No deleting products.
- No buyer-facing messages; those go out through the shop's normal SMS and email.

These stay in the dashboard so a leaked key can't move money or wipe a catalog.
