# Phase 14 — Reports & growth

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 14). Migration **0032_growth** must run
on Neon **before pushing** (`pnpm --filter @gumakart/db migrate`). It adds:

- `product_variants.cost_price` and `order_items.unit_cost` (cost snapshot at the time of sale).
- `sms_campaigns` and `sms_campaign_recipients`.

Pending Phase 2 constraints are now `drizzle-pending/0033_…` (journal idx 33). There are no new
packages.

**Ready to hook up:** SMS campaigns send through Semaphore and need `SEMAPHORE_API_KEY` and
`SMS_OPT_OUT_SECRET` (see `docs/GO-LIVE.md` §1). Until then, production refuses to send and the
page says so. Local and dev use the labeled SMS mock.

## What shipped

### Reports (`/reports`, owner and manager — new permission `reports.view`)

- Ranges: today, 7/30/90 days, this month, last month, this year, or a custom range of up to one
  year. Dates are in Manila time.
- KPIs compared with the previous period: sales, orders, average order, items sold, discounts,
  refunds, delivery fees, profit, and new vs returning buyers.
- A counted sale is any order that is not cancelled or voided. Its value is the total minus
  refunds.
- Daily sales chart with a hover tooltip and a table view.
- Breakdowns by channel and by payment method. Top 20 products and top 10 buyers.
- Repeat-buyer cohorts by month, and stock value at cost and at price.
- CSV exports: orders, products, customers, daily. Cells are formula-safe.

### Cost prices and profit

- Inventory has a **Cost** column, visible to people who can edit products. The CSV import and
  export include a `cost` column.
- Every sale (online, POS, marketplace import, items added after the sale) snapshots the unit
  cost. Profit uses those snapshots. The report shows "cost coverage" so a partial number is
  never shown as the full picture.

### Discounts & deals (`/discounts`, `marketing.manage`)

- **Quantity deals** ("buy 2 or more, 15% off"): pick products, minimum quantity, percent or
  peso off, with an optional start and end. The best deal applies per line.
- **Coupons** now have a start/end window, max uses, **once per buyer** (matched on the last 10
  digits of the phone), and an internal note. The page shows usage counts. Duplicate codes are
  rejected.
- The **automatic discount** has a start/end window.
- Order of application: deals first, then one coupon or the automatic discount on the remainder.
  The checkout, the link checkout and the server all use the same calculation.
- Product pages show a Taglish banner for live deals ("bumili ng 2 o higit pa — 15% off").

### SMS campaigns (`/campaigns`, `marketing.manage`)

- Groups: all buyers, repeat buyers, VIPs (spent at least ₱X), lapsed (no order in N days), new
  (first order in N days), or buyers from one channel.
- **Consent only.** A buyer is included only with `sms_marketing_opt_in`, and opt-outs are always
  excluded. The composer shows reach, a live preview, the SMS-credit estimate and the opt-out
  footer.
- Send now or schedule. Recipients are snapshotted when the campaign is queued. The cron sends in
  batches and never during quiet hours (9 PM–8 AM Manila). Sending is idempotent per recipient,
  and a campaign can be stopped mid-send.
- Links carry `?ref=sms&utm_campaign=c…`, so orders are attributed back. The list shows sent,
  failed, orders and sales per campaign. New sales channel: "SMS campaigns".
- At most 5,000 recipients per campaign. Messages are at most 300 characters.

### Small fixes

- Peso amounts never show one decimal any more ("₱682.30", not "₱682.3"). Whole amounts still
  show without decimals. This is fixed in the shared formatter and in the storefront, checkout,
  admin and platform copies.
- The checkout voucher box only says "Applied" when a coupon code actually matched (a quantity
  deal alone no longer lights it up).

## Honest limits

- Quantity deals apply on the online checkout and link checkout, **not at POS** yet. POS keeps
  its manual discount.
- Profit only covers sales made after a cost was set. Older orders count toward "cost coverage"
  as unknown.
- Campaigns need Semaphore live. Scheduled sends that fall in quiet hours wait until 8 AM.
- Coupon "once per buyer" relies on the phone number. A buyer using a different number can reuse
  the coupon.

## Tests

- db unit (checkout totals with deals, windows, once-per-buyer, channel aliases).
- db integration `growth.test.ts`: reports math, cost snapshots, discount save/validation,
  campaign segments, consent filtering, queue/claim/idempotent send.
- services `recipes.test.ts`: campaign SMS text, ASCII-safe, segment count.
