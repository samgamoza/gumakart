# Phase 27 — Suki loyalty tiers (palenkeAi idea, built on the server)

**One migration:** `0038_loyalty` (journal idx 38). It adds one table, `loyalty_ledger`, and changes
nothing else. The pending Phase 2 constraints were renumbered to `drizzle-pending/0039_phase2_constrain.sql`
(journal idx 39).

**Off by default.** Each shop turns it on in **Settings → Suki loyalty**. Only orders paid after that
moment earn.

## How it works

| | Default | Seller can change |
|---|---|---|
| Earning | ₱100 spent = 1 point | ₱20–₱1,000 per point |
| What earns | Items after discount. Delivery fee, gift-card/store-credit payment and refunds don't. | — |
| When | When the order is paid (COD: once delivered) | — |
| Point value | 1 point = ₱1 store credit | ₱0.10–₱5 |
| Converting | From 50 points, into a store-credit code (the Phase 17 store credit, usable online and at the POS) | Minimum |
| Tiers (spend at this shop, last 12 months) | Bronze 1× · Silver ₱5,000 1.25× · Gold ₱15,000 1.5× · Platinum ₱40,000 2× | The three amounts |

- At the defaults that's 1% back for Bronze and 2% back for Platinum. The settings page shows the
  percentage as the seller edits.
- **Points never become cash.** They only convert to store credit at the same shop.
- **Refunds and cancellations take points back.**
  - A partial refund removes the matching part.
  - A cancelled order removes all of its points.
  - The take-back is kept current, so a second refund corrects it again. A buyer who already converted
    their points can go negative. They then can't convert until they earn it back.
- **The sweep:** `/api/cron/loyalty` runs every 5 minutes, and also when the seller opens Suki loyalty or a
  customer. It's idempotent: one earn row and one take-back row per order, enforced by a unique index.
- **Converting** locks the customer's row, so two clicks can't spend the same points twice. This is
  tested with two requests at once.

## Where it shows

| Who | Where | What |
|---|---|---|
| Seller (owner, manager) | Settings → Suki loyalty | Turn on, rates, tiers. "Your Suki": buyers per tier, unused points (≈ store credit owed), converted in 30 days. |
| Seller (customers access) | Customers → open a buyer | Tier badge, points, ₱ value, 12-month spend and what's needed for the next tier. **Convert to store credit** (needs payments permission) makes a code to send the buyer. |
| Buyer | Order page | "★ Suki Silver — Nakakuha ka ng 12 Suki points…", balance, and how much more for the next tier (Taglish). Hidden if the shop has loyalty off. |
| Public | Palenke AI homepage | "Suki loyalty tiers" card |

Activity log entries: `loyalty.settings`, `loyalty.redeemed`.

## Code

- **Rules (pure):** `packages/db/src/types/loyalty.ts`.
- **Queries:** `packages/db/src/queries/loyalty.ts`
  - `syncLoyaltyPoints`, `getCustomerLoyalty`, `redeemLoyaltyPoints`, `getLoyaltySummary`, `getOrderLoyalty`.
- **Admin routes:**

  | Route | Permission |
  |---|---|
  | `/api/loyalty` | `marketing.manage` |
  | `/api/loyalty/customers/[id]` | `customers.view` |
  | `/api/loyalty/customers/[id]/redeem` | `orders.payments` |
  | `/api/cron/loyalty` | cron secret |

- **UI:**
  - Admin: `components/loyalty/*`, plus the Customers panel.
  - Buyer site: `components/suki-order-card.tsx`.

## Verified

- **Tests:** `src/loyalty.test.ts`, 9 tests covering:
  - the rules
  - nothing earned while off or before turning on
  - unpaid and undelivered COD orders don't earn
  - delivery fee and gift-card amounts excluded
  - tier multipliers, with the tier taken from spend before the order
  - partial and full refunds and cancellations, with no rewrites when nothing changed
  - concurrent conversions, where exactly one wins
  - the summary and the buyer view

  The full db integration suite has 174 tests.
- **In the browser on a local production build:**
  1. Turned it on in Settings.
  2. A buyer's points appeared in Customers.
  3. **Convert to store credit** made a code (51 points → ₱51).
  4. The buyer's order page showed the Suki card.

## Follow-ups

- **Buyer self-serve conversion.** Today the seller converts and sends the code. A "use my points"
  button at checkout could apply them directly.
- **POS:** show the buyer's tier and points when their phone is entered at the register.
- **Win-back campaign:** "Miss ka na namin" SMS to lapsed Silver and above buyers, using the existing
  SMS campaigns with consent.
