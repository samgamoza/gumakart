# Phase 5 — POS Lite

Plan §12. Built inside Guma Kart: a POS sale is an ordinary order (`source_channel = 'pos'`), paid and
picked up in one transaction, so in-store and online sales share stock, customers, the Orders list
(tag "In-store (POS)") and the dashboard (new "In-store (POS)" tile next to links / online store).

## Data — migration `0025_pos_lite` (additive)

- `pos_staff` (name unique per shop, role cashier/manager, bcrypt PIN hash, `pin_version`, lockout fields)
- `registers` — one per location (unique `location_id`); created on first use at the default location
- `register_sessions` (shifts) — one open per register (partial unique index); opening cash; expected /
  counted / variance per tender (JSON); who opened / closed; note
- `orders` + `register_session_id`, `pos_staff_id`, `pos_idempotency_key` (unique per shop),
  `pos_meta_json` (tenders, change, VAT breakdown, senior/PWD name + last 4 of ID, cashier)
- Pending Phase 2 constraint file renumbered (now **0031** after Phase 12b) (`drizzle-pending/0031_phase2_constrain.sql`);
  its one-live-charge index and verify query V4 now skip POS tender rows (`pos_<order>_<n>`), since a
  split sale has two paid rows. Dry-run on local DB: clean.

## Sale (`packages/db/src/queries/pos.ts` → `createPosSale`)

One transaction: lock the shift (must be open) → price from the catalog (default variant, same as
checkout) → VAT/discount → tenders → order number → customer upsert (if a mobile is given) → order
(`completed / paid / delivered`) → items → history (`pos_sale`) → one `payment_transactions` row per
tender (`gateway = manual`, `paid`; cash row = what the drawer kept) → atomic stock decrement (never
below zero, same rule as online) + stock ledger → outbox `Order.Created.V2` + `Order.Completed.V1`.

- **Idempotent:** the register makes one key per Charge attempt; a retry (or double tap) returns the
  first sale with `duplicate: true`. Unique index backs it up under a race.
- **Tenders:** up to two of cash / GCash / Maya / card (card = recorded only). Only cash gives change;
  e-wallet/card can't exceed the amount due.
- No wallet/platform-earnings entries (merchant-direct money). No SMS recipes fire for POS sales.

## Tax — `packages/db/src/types/pos-tax.ts` (pure, shared by screen and server)

Ported from Veyron `app/core/tax.py` with its test cases: VAT-inclusive extraction, VAT-exclusive add-on,
**Senior/PWD VAT-exempt: strip VAT, then 20% off** (₱112 → ₱80, not ₱89.60), non-VAT sellers get 20% off
the price as-is. Default for shops: **not VAT-registered** (most small sellers); Settings → POS & staff
turns VAT on. Senior/PWD needs the ID number; receipt shows name + last 4 digits. Receipts say
"This is not an official receipt" (BIR OR/SI later).

## Who can use the register

- **Owner** (normal seller login) can sell from `/pos` as manager.
- **Device:** owner taps "Use this device for cashiers" → signed 180-day device cookie for that shop.
- **Cashier/manager:** on that device `/pos/login` → pick name → PIN (4–6 digits, no 1111/1234). Signed
  14-hour staff cookie, separate key from seller sessions. Unlocking with a PIN **signs the owner out on
  that device**, so a cashier can only reach `/pos` and `/api/pos/*` — verified: `/api/orders`,
  `/api/pos-staff`, `/orders` all refuse/redirect.
- 5 wrong PINs → that person locked 15 min; per-IP limit 20 tries / 5 min. PIN reset, role change or
  turning someone off bumps `pin_version` → their open session stops working at once.
- Settings → **POS & staff** (owner only): add staff, role, reset PIN, turn off; VAT switches; recent
  shifts with Balanced / Short / Over.

## Register screen (`/pos`)

Open shift (cash in drawer) → search or scan (barcode scanner types the SKU + Enter) → product tiles
with stock left → cart (qty, Senior/PWD + name/ID) → Charge: method, quick cash amounts, optional split,
reference no., optional buyer name/mobile → receipt (print 72 mm, text receipt, change to give) →
New sale. Sales list for the shift; Close shift: counted vs expected per method with live variance,
note → Balanced / Short / Over. Phone layout: grid + sticky "N items · total · Charge" bar.

## Tests

- `src/types/pos-tax.test.ts` (19): Veyron VAT/PWD cases, config parsing, tender rules.
- `src/pos.test.ts` (8, integration): sale = completed/paid/pos with stock, payment rows, customer;
  retry/double tap → one sale, stock once; **online + POS racing for the last unit → exactly one
  wins**; short payment leaves nothing behind; senior on VAT shop ₱112 → ₱80; shift close variance and
  no sales after close; staff name unique, PIN lockout, reset bumps version, tenant isolation.
- `packages/auth/src/pos-token.test.ts` (3): device/staff tokens can't be swapped with each other or
  with seller sessions; PIN rules.
- Manual (local, screenshots): owner sale with Senior discount; device setup; Jen PIN unlock; split
  GCash + cash on a phone; close shift short ₱20.

## Not in V1 (plan)

Offline mode, BIR OR/SI numbering + X/Z readings, more than two tenders, multiple registers per
location, voids/returns at the register (use Orders → refund for now), customer display.

## Deploy

Run the Neon migrate (**0025**) before pushing — the POS pages read the new tables. No new secrets
(`AUTH_SECRET` signs the POS cookies). Receipt texts need `SEMAPHORE_API_KEY` like other SMS.
