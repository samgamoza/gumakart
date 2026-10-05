# Phase 12b — POS offline mode

Done before Phase 13 at the owner's request ("Build POS offline first"). Migration
**0030_pos_offline** must run on Neon **before pushing** (`pnpm db:migrate` with the Neon
`DATABASE_URL`). Additive only: two order columns and two tables. Pending Phase 2 constraints are
now `drizzle-pending/0031_…` (journal idx 31). No new secrets, no new packages.

## What shipped

### At the register (/pos)
- **Keeps selling without internet.** The header shows Online / Offline with a count of sales
  waiting. Offline, a banner says sales are saved on this device and sent automatically, and how
  old the prices and stock are.
- **Offline sale = normal sale at the counter**: same cart, discounts, split payment, change and
  printed receipt (marked "Rung offline"). Stock counts on the tiles go down on the device.
- **Sync**: sent oldest first when the connection is back (on the browser's online event and every
  20 s), with the same idempotency key, so a sale that already reached the server is never saved
  twice. A message says how many were sent and whether any need a look.
- **Opens with no internet**: a small service worker (`/pos-sw.js`, scope `/pos`, production only)
  keeps the register page and its files; the register state and products come from this device's
  last online visit. API calls are never cached.
- **Guards**: Close shift waits until waiting sales are sent (and needs internet); Lock needs
  internet (unlocking checks the PIN on the server); texting a receipt and void/return work after
  the sale is synced. Private-mode / blocked storage is detected and the register says it can't
  sell offline.

### On the server (createPosSale with `offline`)
The money and goods already changed hands, so an offline sale is recorded even when things changed
in between, and an **offline-sale issue** is filed for the owner instead of refusing it:
- **Stock ran short** → takes what's there (never below zero), "Recount it".
- **Price changed** → keeps the price the buyer paid; if the shop's VAT settings changed, keeps the
  printed total.
- **Product archived / option removed** → still recorded.
- **Shift closed meanwhile** → the sale lands on the shift it was rung in (the cash was in that
  drawer) and the shift's expected cash and variance are recomputed. **After a Z reading** → also
  flagged ("not in that Z reading's totals").
- **Couldn't be saved at all** (product deleted, payments don't add up) → the whole sale is kept as
  a "Not saved as a sale" issue and the device stops retrying.
- Sale time = the device's time, kept inside the shift (device clocks drift).
- Online sales are unchanged (still refuse out-of-stock, closed shift, etc.).

### BIR on: offline invoice numbers
- Each register device reserves a **block of 25 numbers** off its register's counter while online.
  Offline receipts print the next number from that block, so the printed number is real and never
  reused. Online sales keep drawing from the counter after the block.
- When a block is used up the device gets the next one the next time it's online; if all are used
  while offline, the register says to connect before selling more.
- On sync the number is accepted only if it's inside **that device's** block and unused; otherwise
  a new number is assigned and an "Invoice no. changed" issue tells the owner to note it on the shop
  copy.
- Settings → POS → BIR card lists the blocks per device (used/size) with **Release…** for a lost or
  retired device (unused numbers are then never issued — note them for the accountant).
- The e-journal CSV has a new `rung_offline` column.

### Owner / manager
- Register: "N offline sales need a look" → list with **Checked**.
- Settings → POS → **Offline sales** card: the same list, plus checked ones.
- Activity log entries for "checked" and block releases.

## Honest limits
- Offline needs the register to have been opened **online once** on that device (to save products,
  shift and, with BIR, an invoice block). Opening a shift, switching cashier (PIN) and locking need
  internet.
- Prices, stock and promos are as of the last online visit; the server flags what changed.
- With BIR on, numbers from different devices (and a device's offline block vs later online sales)
  aren't in time order — each block is in order. Check this with the accountant/RDO before relying
  on offline mode with BIR.
- If a sale reached the server but the reply was lost (connection dropped mid-request) **and** BIR
  is on, the printed offline number may differ from the recorded one (the server keeps its own).
- Sales wait in this browser's storage. Clearing site data before they're sent loses them; the
  register warns at 300 waiting sales.
- Product photos aren't shown offline (tiles show the initial).

## Tests
- Integration `pos-offline.test.ts` (11): device time clamping, idempotent offline sync, stock short
  (never below zero; online still refuses), price kept + flagged, archived product, bad tenders
  refused, late sale on a closed shift fixes the variance, after-Z flag, rejected sales kept once,
  issues resolve, BIR blocks (reserve, reuse, online skips the block, foreign/reused numbers
  reassigned, next block, release, e-journal column).
- Admin unit `lib/pos-offline.test.ts` (9, new `pnpm --filter admin test`): outbox order, stop on
  no connection, parked, locked, server errors, storage full, invoice block numbering and recovery.
- db unit 68 ✓ · db integration 104 ✓ · auth 9 ✓ · admin 9 ✓ · typecheck clean (admin, web,
  platform) · admin production build ✓. Browser check: go offline, sell, queued list, close-shift
  guard, back online → synced with stock-short issues; production build: reload with no internet
  opens the register from the service worker and a sale made then syncs.
