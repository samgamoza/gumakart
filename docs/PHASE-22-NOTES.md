# Phase 22 — Buyer demand capture

**Migration:** `0041_demand` (run it on Neon before pushing). It adds the `stock_alerts` and `wishlist_items` tables and `order_items.preorder_ship_date`.
The pending Phase 2 constraints file moved to **`drizzle-pending/0042_phase2_constrain.sql`** (journal idx 42 when it's applied).
There's no new secret.

## Back-in-stock alerts ("Notify me")

**Buyer side**

- **Where it shows:** on a sold-out item, or a sold-out size or colour, the buy button becomes **Notify me when it's back**.
- **What the buyer leaves:** a PH mobile number ("Text me") or an email. If they're signed in to Guma ID, the alert is linked to their account.
- **Limits:** one request per contact per item. The API refuses if the item is actually in stock.
- **Gap fixed:** before this phase, products without options never showed "sold out" on the storefront; buyers only found out at checkout. The storefront now knows `available` for every product.

**Sending**

- **When:** the timed automations cron, every 5 minutes. It doesn't run between 9 PM and 8 AM.
- **Order:** oldest request first. Per item, at most **max(5, 2 × stock)** messages per run, so a restock of 2 doesn't text 200 people at once.
- **What's sent:** one message per request, as a **service** text (the buyer asked for it) or email: *"Tess Lifestyle PH: May stock na ulit ang Minimal Desk Lamp! Order na habang meron pa: {product link}"*. It respects opt-outs, is logged in the shop's SMS log, and costs SMS credits.
- **Without Semaphore (or Resend for emails):** requests stay **waiting**. The seller sees the list and can message buyers by hand.

**Seller side (Stock page)**

- "N waiting" appears under the stock number.
- A **demand panel** shows "Waiting for a restock". Tapping it lists the contacts, oldest first; this needs the customers permission.

## Wishlist (Saved items)

- **Buyer side:** a heart on the product page and on product cards, a heart in the shop header, and a **`/{shop}/saved`** page.
- **Where it's stored:**
  - **Guests:** saved on the device, and also recorded on the server under an anonymous device id (a random value kept in the browser).
  - **Guma ID:** saves follow the account. When a guest signs in, the device's saves move onto their account the next time they open Saved.
- **Seller side:** the demand panel shows **Most saved** with real counts only. Buyers never see a count.
- **Privacy:** the Guma ID data export now includes saved items and back-in-stock requests. Deleting the account removes both.

## Pre-orders

- **Seller side:** **Products → Edit → Take pre-orders** with an **expected ship date**.
- **While it's on:**
  - Buyers can order past stock. The product page shows "Pre-order — ships around Oct 31, 2026" and the button reads **Pre-order now**. Cards show "Pre-order".
  - **Pre-order lines don't take stock** (no decrement, no "sold out" error). Each line keeps the ship date as it was when ordered.
  - The buyer's order page shows "Pre-order — ships ~Oct 31" on that item. The seller's order list shows a **Pre-order** badge.
  - The demand panel's **Pre-orders to ship** lists open units per product, so the seller can set them aside when goods arrive.
- **Ends by itself** the day after the ship date; normal stock rules then apply.
- **POS** is unchanged: it sells what's on the shelf.

**Not built: deposits.** A "pay X% now, the rest on arrival" deposit needs partial-payment states across PayMongo, the payment proof flow and COD. It's left for a later phase rather than bent into the current flow. Pre-orders are paid in full, or COD, today.

## Code

| Area | Files |
|---|---|
| DB | `drizzle/0041_demand.sql`; `schema/index.ts` (`stockAlerts`, `wishlistItems`, `orderItems.preorderShipDate`, product `metadataJson.preorder`); `types/demand.ts` (`activePreorder`, `shipDateLabel`); `queries/demand.ts`; `queries/orders.ts` (pre-order lines); `queries/storefront.ts` (`available`, `defaultVariantId`, `preorderShipDate`); `queries/guma-id.ts` (export/delete); test `demand.test.ts` (6) |
| Services | `backInStockSms` (+ test) |
| Admin | `lib/stock-alerts.ts` (sender, called from `runTimedAutomations`); `api/demand` (`products.view`), `api/demand/waiting/[productId]` (`customers.view`); `components/demand-panel.tsx`; inventory waiting counts; product form pre-order toggle; orders pre-order badge |
| Buyer site | `components/storefront/add-to-cart.tsx`, `notify-me.tsx`; `components/wishlist-button.tsx`, `saved-items.tsx`; `lib/wishlist.ts`; `app/[tenantSlug]/saved`; `api/stock-alerts`, `api/wishlist`; header heart; order page pre-order line |

## Verified

Local production build:

- **Pre-order:** in Admin, Wireless Headphones was set to pre-order for Oct 31. The product page then showed "Pre-order — ships around Oct 31, 2026" and **Pre-order now**.
- **Notify me:** Minimal Desk Lamp at 0 stock showed **Notify me**. A phone number was saved ("We'll text you once when it's back").
- **Saved:** hearts on both products. The Saved page listed both.
- **Stock page:** the lamp showed "1 waiting". The demand panel showed Waiting 1, and Most saved 1 + 1.
- **Sending:** after restocking the lamp to 20, the sender sent one SMS (mock), and the request turned **notified**. The test shop was put back afterwards.

**Tests:** db integration 199 (+6), services 75 (+1), db unit 105, admin 14, web 3, route audit 9. Admin and web build.
