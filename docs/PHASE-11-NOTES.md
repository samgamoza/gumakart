# Phase 11 — After-sale and BIR-ready POS

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 11). Migration **0028_after_sale** must
run on Neon **before pushing** (`pnpm db:migrate` with the Neon `DATABASE_URL`). It adds columns
and tables, three stock-movement reasons, and narrows the "one movement per order" guard to the
original sale/restock reasons. Pending Phase 2 constraints are now `drizzle-pending/0029_…`.
No new secrets. PayMongo partial refunds use the existing client (labeled mock until keys are set).

## What shipped

### Orders → "More" on every order
- **Notes & tags** — a team-only note and up to 10 tags (VIP, Rush, Gift…). Tags show on the card,
  filter the list, and are suggested from what the shop already uses. Staff can add them.
- **Edit items** (manager/owner) — before packing: change quantities, remove lines, add products
  (size picker for products with options). Stock moves with every change. Existing lines keep the
  price the buyer saw; added lines take today's price. **Paid orders can only go down**; the
  difference is shown as "give back ₱X" (or refunded online for PayMongo orders).
- **Return / refund** (manager/owner) — after the buyer has the goods: per item quantity, put back
  in stock or not, **swap for another size/colour** (exchange; the price difference is refunded or
  collected), and **any refund amount up to what's left**. When refunds reach the total, the order
  closes as Refunded through the normal state machine. Full "Refund" still works and now only
  refunds what's left.
- **History** — every edit, return, exchange and void with who, when, items and money.
- **Packing slips** — single from "More", or "Print packing slips" for the whole To pack / To ship
  tab: big order number, buyer, address, checkbox per item with SKU and quantity, buyer and team
  notes, and a bold **COD amount to collect**. One per page when printed.

### POS
- **Void** a sale from the current shift (manager/owner, with a reason): stock back, it leaves the
  drawer total, marked VOIDED on the receipt.
- **Return at the register** (manager/owner): pick items, restock, refund by cash/GCash/Maya/card —
  the refund comes off **this shift's** expected drawer (shift summary now has a refunds line).
- Cashier PINs can't void or refund; a manager unlocks with their PIN.

### BIR-ready POS — Settings → POS → "BIR sales invoices" (off by default)
- Owner fills in registered name, TIN, branch, address, MIN, serial, PTU no./date, accreditation
  (if any) and an invoice prefix; **Turn on** only works when the required fields are there and
  asks for confirmation (PTU + accountant go-signal). Managers can see but not change it.
- When on: each POS sale gets the next **sales invoice number per register** (assigned inside the
  sale's transaction, never reused), and the receipt prints the BIR header (VAT/NON-VAT REG TIN,
  MIN, SN, PTU, "NOT VALID FOR CLAIM OF INPUT TAX" for non-VAT).
- **X reading** for any shift (Recent shifts → X reading). **Z reading** per register at end of day
  (needs the shift closed), numbered, with accumulated grand total before/after; history list.
- **E-journal CSV** for any date range (≤ 92 days): every receipt with invoice no., items,
  discounts, VATable/VAT/exempt, refunds, voids and tenders.

## Honest limits
- Guma Kart is **not** a BIR-accredited CAS/POS provider; this is built to the usual
  requirements so a shop can go through its RDO/accountant. Formats may need adjusting after that
  review. Turning it on doesn't make a shop compliant.
- **POS offline mode is not built** (sales need a connection). It's the riskiest part of the phase
  (queued sales, invoice numbers offline) and deserves its own slice.
- Partial refunds don't adjust the (simulated, hidden) seller wallet; full refunds do, as before.
- Online orders: returns are for **delivered** orders; packed/shipping orders use cancel/refund.
- Exchanges are within the same product (size/colour); swapping to a different product = return +
  new order.

## Tests
- Integration `after-sale.test.ts` (12): tags, edit with stock/totals, paid-only-down, blocked when
  packed, POS return restock + drawer, over-refund refused, exchange stock + collected, full refund
  closes the order, void same-shift only, online-not-received refused, BIR numbering only when
  complete, X/Z readings and grand total, e-journal.
- Permission tests updated (13). db unit 68 ✓ · db integration 85 ✓ · typecheck clean · admin and
  web production builds ✓. Browser check: notes/tags, edit with an added product, packing slips,
  BIR switch, numbered receipt, return at the register.
