# Phase 17 — Seller polish: deals at the POS, gift cards & store credit, branch stock

**Before pushing:** run migration **0035_seller_polish** on Neon (`pnpm --filter @gumakart/db migrate`).
If 0032–0034 haven't been run yet, run them first; `migrate` applies them in order.

0035 does the following:

- **Gift cards.** It adds the `gift_cards` and `gift_card_txns` tables and the `orders.gift_card_amount` column.
- **Branch stock.** It adds the `location_stock` table and the `tenants.branch_stock_enabled` column.
- **Enum values.** It adds `transfer_out`, `transfer_in` and `branch_count` to the stock-movement reason enum.
- **Trigger.** It adds the `guma_branch_stock_sync()` function and the `product_variants_branch_stock` trigger.
  - The trigger runs `AFTER INSERT OR UPDATE OF stock_qty`.
  - It does nothing unless the shop has branch stock turned on.

The pending Phase 2 constraints are now `drizzle-pending/0036_phase2_constrain.sql` (journal idx 36).

No new secrets.

## What shipped

### Deals at the POS

- The shop's published **quantity deals** and **automatic discount** now apply at the POS register as well as online.
  - They appear as their own line on the cart and on the receipt, for example "Mug bundle −₱104.70".
  - They come off before VAT.
  - BIR X/Z readings count them under regular discounts.
- **Senior/PWD:** the buyer gets the better of the 20% discount or the deal, never both. This is RA 9994 practice.
- Pure rules live in `computePosSaleTotals` (`types/pos-tax.ts`) and `computeStorePromotion` (`types/tenant-checkout.ts`).

### Gift cards & store credit

- **Where to manage them:** Admin → **Gift cards** (`/gift-cards`, permission `orders.payments`).
- **Issuing a card:**
  - Set an amount, an optional name, mobile, note and expiry.
  - The seller gets a code like `GC-XXXX-XXXX`.
- **Managing cards:**
  - The list shows the balance and history.
  - Sellers can adjust the balance (the reason is logged) and disable or re-enable a card.
- **Online checkout and checkout links:**
  - The buyer enters the code. The order summary shows the "Gift card" line and the amount still to pay ("Babayaran").
  - If the card covers the whole total, the order is paid at once. No COD or GCash step follows.
  - If it covers part, the buyer pays the rest by the method they chose. PayMongo, manual GCash and COD are all charged only the amount due.
- **POS:**
  - There's a **Gift card** tender. "Check" shows the balance on the card.
  - It can be split with cash or e-wallet.
  - At close, the gift card amount counted always equals the amount expected, with no variance.
- **Returns:** "Store credit" is a refund method on POS returns and on the order page. It issues a store-credit card, and the code appears in the notice.
- **Money goes back to the card when:**
  - an order is cancelled or expires
  - an order is fully refunded
  - a POS sale is voided

  Restoring is idempotent: it never restores the same amount twice.
- **Gateway refunds** (PayMongo) exclude the gift-card part.

### Branch stock

- **Setting up branches:** Settings → **Branches** (`/settings/branches`).
  - Add up to 20 branches: a stall, a bodega or a second store.
  - Adding the second branch turns on branch stock. Today's stock is seeded into the main branch.
- **Stock → By branch** (`/inventory/branches`):
  - One column per branch.
  - **Move stock** transfers between branches. The total doesn't change, and it's logged as `transfer_out`/`transfer_in`.
  - **Count a branch** sets that branch's numbers and moves the total by the difference (`branch_count`).
- **POS:** a branch picker in the header (`gk_pos_branch` cookie). Each branch has its own register and sells from its own stock.
- **Online orders:** they take from the main branch first.
- **Invariant:** the branch numbers always add up to `product_variants.stock_qty`. The trigger keeps it that way, and the integration test checks it.

## Tests

- Unit: `src/seller-promo.test.ts` (10 tests): promos, senior-vs-deal, code format.
- Integration: `src/seller-polish.test.ts` (18 tests). It covers:
  - gift card lifecycle
  - partial and full gift card checkout
  - restore on cancel (idempotent)
  - POS deal and senior choice
  - gift card tender, including split and refusal of a short card
  - void restore
  - store credit return
  - shift close
  - branch seed, transfer, count, spill and POS-at-branch
- Totals: unit 100 passed, integration 151 passed, services 73 passed. Typecheck is clean. Admin, web and platform production builds pass.
- The browser pass caught a bug the tests missed: `/api/pos/sales` rejected the `gift_card` tender. It's fixed.

## Honest limits

- **No coupon codes at the POS.** Only the automatic deals apply. Coupons stay online-only.
- **Gift cards need the POS to be online.** The tender is hidden while offline, because the balance must be checked and locked live.
- **Partial returns don't put the gift-card part back.** It goes back only when the order is fully refunded or cancelled. For partial cases, use "Store credit" as the refund method.
- **Online orders don't choose a branch.** They take from the main branch, then spill to other branches (largest first) if the main one runs out. Pick-up-at-branch is a later step.
- **An oversell at one branch spills to the others.** The shop-wide total stays right, but a branch's number can drop when another branch sold. A count at that branch fixes it.
- **Gift card PINs, physical card printing and selling gift cards online** are not in this phase. Cards are issued by the seller, for example after they're paid in cash.
