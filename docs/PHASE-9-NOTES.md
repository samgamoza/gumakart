# Phase 9 — Variants & stock

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 9). Migration **0026_variants** must run
on Neon **before pushing** (`pnpm db:migrate` with the Neon `DATABASE_URL`, the same way you ran
0025). It only adds columns and indexes; existing products keep working as one "Default" variant.
No new secrets.

## What shipped

### Sizes & colours (options + variants)
- Products → **Add sizes** / **Sizes & colours** opens the editor: up to 3 options (Size, Color,
  Flavor…), 20 values each, 100 variants. One row per combination with its own price,
  compare-at price, stock, SKU and barcode; "price/stock for all" bulk fill.
- Rules (`packages/db/src/queries/variants.ts`): the old Default variant becomes the first
  combination (its stock history stays); removed combinations are **turned off, never deleted**
  (past orders, links and the ledger point at them); duplicate combinations and a SKU used by
  another product are refused; every stock change writes a ledger row; `products.base_price`
  follows the cheapest variant (listings show "From ₱…").
- For a product with options, the product form locks price and stock (they're per variant) and
  links to the editor. A stray price edit through the old API is ignored.

### Selling a variant — every channel
- **Online store**: product page has a size/colour picker (sold-out values struck through,
  price updates per pick). Template "Add to cart" buttons on a product with options open the
  product page instead of adding an unpriced line (works for all 25+ templates via one registry).
  Cart lines are per variant; checkout shows "Sand / 20L".
- **Checkout links**: the link builder asks which size for products with options (sold-out sizes
  disabled). The buyer's link page shows the variant and its price.
- **POS**: tapping a product with sizes opens a picker with price and "N left" per size; scanning a
  variant's SKU or barcode adds that exact size.
- Server side: orders, POS sales and links all **require** a variant for products with options
  ("Pick a size or option for …") and charge the variant's price; stock is locked and decremented
  per variant (same oversell protection as before).

### Stock tools — new **Stock** page (`/inventory`)
- Every stock-tracked item (each size counts as an item) with All / Low / Sold-out filters and
  search-or-scan.
- **Stock count**: type what's on the shelf, see +/- per row, Save → numbers replaced, each
  difference logged in the stock history ("Stock count").
- **CSV export / import**: export opens in Excel or Sheets (`product, product_slug, variant, sku,
  barcode, price, stock`); edit price/stock and import. Import always shows a **preview** first
  (what changes, which rows are skipped and why); confirming applies all rows in one transaction.
  Matching is by SKU, else product slug + variant name. Formula-looking cells are neutralised on
  export.
- **Low-stock alert**: threshold setting (default 3) at the bottom of the Stock page; the
  dashboard shows "N items running low · M sold out" with a Restock link when any are at/below it.

## Honest limits (by design for now)
- CSV import **updates** existing items only — new products are still added on Products.
- Checkout links pin **one variant per product line**; the buyer can't switch sizes on a link
  (make one link per size, or send the shop link).
- Per-variant photos: the editor keeps the existing photo per variant but has no per-variant
  upload yet; the product photo shows for all sizes.
- **Multi-location stock is deferred** (one stock number per variant). The ledger already has a
  `location_id` column, so it can be added without rewriting history.

## Tests
- New integration suite `packages/db/src/variants.test.ts` (14 tests): save rules, deactivation,
  product-edit guard, order/POS/link by variant, sold-out refusal, storefront catalog, stock count
  + ledger, cross-shop refusal (nothing written), CSV round-trip/plan/apply, formula escaping,
  low-stock threshold.
- db unit 55 ✓ · db integration 64 ✓ · typecheck clean (db, services, auth, admin, web, platform) ·
  admin and web production builds ✓.

## Files
- db: `drizzle/0026_variants.sql`, `queries/variants.ts`, `queries/inventory.ts`, `orders.ts`,
  `pos.ts`, `checkout-links.ts`, `products.ts`, `storefront.ts`, `types/tenant-settings.ts`
  (`inventory.lowStockThreshold`).
- admin: `components/product-variants-editor.tsx`, `components/inventory-manager.tsx`,
  `app/inventory`, `app/api/products/[productId]/variants`, `app/api/inventory/*`, products,
  checkout-links, POS register, dashboard alert, nav "Stock".
- web: `lib/cart.ts` (lines keyed by variant), `components/storefront/add-to-cart.tsx` (picker),
  `variant-product-registry.tsx`, checkout form, link checkout, `place-order.ts`.
