# Phase 24 — Faster fulfilment

**Migration:** `0042_fulfilment` (run it on Neon before pushing). It adds `deliveries.courier_name` and `deliveries.tracking_number`.
The pending Phase 2 constraints file moved to **`drizzle-pending/0043_phase2_constrain.sql`** (journal idx 43 when it's applied).
There's no new required secret. The waybill aggregator is ready to hook up (see below).

## Batch packing

On **Orders → To pack** (and **To ship**), each order has a tick box, and there's **Select** (all), **🖨️ Pick list + slips (N)** and **Mark N packed**.

- **Pick list:** one page, printed first. Every item to take off the shelf, grouped by item and SKU, with the total
  quantity, the orders it goes into (e.g. `TES-0241, TES-0242×2`) and a tick box. Then the existing packing slips,
  one per page.
- **Mark N packed:** sends each order through the normal order service (the same as the one-by-one **Mark packed** button).
  Orders that can't move are listed with the reason, not forced. One activity log entry is written for the batch.
  It needs the `orders.fulfil` permission (staff and up).
- **Limit:** 50 orders per batch (the same as packing slips). With nothing ticked, the print link uses every order on the tab.

## Barcode and price labels

The labels page is **Stock → Print barcode labels** (`/products/labels`).

- **Sizes:** **Thermal 40 × 30 mm** (one per page; set the label printer to 40×30) or an **A4 sheet** (3 × 8, 70 × 37 mm).
- **Content:** shop name, price (optional), item and option, the barcode, and the code in text.
- **How many:** a number per item, or **1 of each** / **One per item in stock**.
- **Barcodes:** the variant barcode is used, or the SKU if there's no barcode. **Give them in-store barcodes** fills the
  gaps with an in-store EAN-13 (prefix 20–29 is reserved for in-store use, so it never clashes with a maker's
  barcode). Existing barcodes are never changed.
- **Encoding:** Code 128, drawn with a small built-in encoder (`lib/code128.ts`), so no new dependency. It was checked against
  python-barcode's output for letters, even and odd digit counts, and EAN-13 numbers.
- **POS:** scanning a label adds the item. A product without sizes is added by its variant's barcode too (this was made
  explicit in `onScan`).

## Parcel couriers and waybills

**Orders → Assign rider** is now **Assign rider or courier**, with a "Parcel couriers" group: **J&T Express, LBC,
Flash Express, Ninja Van, 2GO, Other courier**.

- **Picking a parcel courier** asks for the **waybill/tracking number** instead of rider details. The number is saved without spaces, in capitals.
- **Buyer:** the order page shows **"Shipped — J&T Express · Tracking no. 7801234567890"**. The "shipped" text says
  *"Tess Lifestyle PH: Naipadala na ang order #TES-0242 via J&T Express. Tracking no. 7801234567890. Track: {order link}"*.
  It is sent once, on booking, like the rider text.
- **Riders** (Angkas, own rider…) work exactly as before.

**Ready to hook up:** `packages/services/src/delivery/waybill.ts` defines a `WaybillProvider` (couriers, quote, book →
tracking number and label URL) and `createWaybillProvider()`, which returns `null` until an aggregator adapter is added and
`WAYBILL_PROVIDER` / `WAYBILL_API_KEY` are set. Then the orders page can offer "Book & print waybill". The seller's
typed-in tracking number keeps working either way.

## Delivery fee by area

**Settings → Delivery & Shipping** (own delivery) has a new **Fee by area** section: **Metro Manila, Rest of
Luzon, Visayas, Mindanao**.

- **How it's charged:** checkout charges by the buyer's province. An area left blank, or a province that isn't recognised, pays the flat fee.
- **Free delivery** above the minimum still wins over any area fee.
- **Province matching:** province lists live in `packages/db/src/types/ph-areas.ts`. They're checked Metro Manila → Mindanao → Visayas → Luzon, so
  "City of Isabela" (Basilan) isn't mistaken for Isabela province.
- **Exception:** a shop that published a custom shipping profile in the Shipping workspace keeps using that profile. Area rates apply to the simple
  settings.

## Code

| Area | Files |
|---|---|
| DB | `drizzle/0042_fulfilment.sql`; `schema` (deliveries courier/tracking); `queries/deliveries.ts` (parcel waybill, rider details optional); `queries/orders.ts` (tracking view); `queries/automations.ts` (SMS context); `queries/inventory.ts` (`assignMissingBarcodes`); `types/ph-areas.ts`, `types/tenant-shipping.ts` (area zones); tests `fulfilment.test.ts` (2), `tenant-shipping.test.ts` (+2) |
| Services | `riderBookedSms` (tracking number), `delivery/waybill.ts` (ready-to-hook), test |
| Admin | `api/orders/bulk`; `components/packing-slips.tsx` (pick list); `orders-manager.tsx` (selection, bulk, courier/tracking); `api/orders/[id]/assign-rider`; `lib/code128.ts` (+ test), `components/label-printer.tsx`, `app/products/labels`, `api/inventory/barcodes`; `settings/delivery-settings.tsx`; `pos-register.tsx` scan |
| Buyer site | order page "Shipped" card |

## Verified

Local production build:

- **Batch:** two To-pack orders were ticked. The pick list grouped them ("Canvas Backpack — 3: TES-P241, TES-P242×2"; "Ceramic Coffee Mug — 5"), and **Mark 2 packed** → "2 orders marked packed."
- **Waybill:** TES-P242 was given J&T Express with "780 1234 5678 90". The seller saw "shipped via J&T Express · 7801234567890", and the buyer's page showed the courier and tracking number.
- **Labels:** **Give them in-store barcodes** set 10 items. Then **1 of each** previewed 10 labels with readable Code 128.
- **Area rates:** the four area fees saved to settings. Checkout fees by province are covered by unit tests.
- **Cleanup:** the test orders and area rates were removed afterwards. The test shop keeps its generated barcodes.

**Tests:** db unit 107 (+2), db integration 201 (+2), admin 17 (+3 Code 128), services 76 (+1), web 3, route audit 9. Admin and web build.
