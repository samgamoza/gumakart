# Security slice G2 — money and data integrity (2026-10-09)

Source: the three-app security audit of 2026-10-07 (project doc `claude/security-audit-2026-10-07.md`), Guma Kart findings GK-6, GK-13, GK-14, GK-15, GK-16, GK-17, GK-18, GK-19.

**Migration:** `0044_security_g2` — `pnpm db:migrate` against Neon **before** pushing (additive: two tables, four columns, two indexes; the CHECK rules are added `NOT VALID` and validated afterwards, so no long lock). `MIGRATION_HEAD` points at it.
**Deploy:** all three apps. No new env.
**Keep `WALLET_PAYOUTS_ENABLED` off** until you have read the wallet section and are happy with the numbers on a real shop.

## What changed

### Wallet (GK-6)
- **Only gateway money is credited.** A sale credit is written only when the paid charge row is PayMongo/Xendit (the platform holds the money). COD cash, seller-confirmed transfers and gift cards never create a balance that could be paid out. The credited base is the subtotal capped at what the gateway collected.
- **Relative, locked updates.** Every balance change goes through one function that locks the wallet row and applies deltas; no read-then-write anywhere. Releasing a pending credit is a compare-and-swap on the ledger row, so overlapping settlement runs release once.
- **Partial refunds debit the wallet** (`refund_debit` with a unique `reference` per return/edit); a full refund takes back whatever the partials left credited.
- **Refunds bigger than the balance are never absorbed at ₱0:** the shortfall becomes `owed_balance`, later credits pay it down first, and payouts are refused while anything is owed.
- **Payouts are claimed once** (`queued → processing` compare-and-swap, `claimed_at`, `attempts`).
- **Nightly reconciliation** (`reconcileWallets()`, run by the wallet-settlement cron) checks every wallet against its ledger — identity: available + pending − owed + payouts = Σ sale credits + Σ refund debits + Σ adjustments — and records the result in `wallet_reconciliations`; mismatches are recorded, never auto-corrected.
- Database rules: wallet balances ≥ 0, `refunded_amount ≤ total`, payment and return amounts ≥ 0; one sale credit per order; unique ledger reference.

### Refund idempotency (GK-13)
A gateway refund is **recorded first** (`gateway_refunds`, one row per refund: unique per order for a full refund, per return row for a partial) inside the order's transaction, and **sent after commit** through `settleGatewayRefund()`, which claims the row before calling PayMongo. A transaction that rolls back moves no money; a repeated request finds the recorded row; a failed send stays `failed` with the error and is retried with `POST /api/orders/:id/refunds/:refundId/retry` — never sent twice. The refund route answers with `gatewayRefundPending` + a warning when the send failed. (The order page UI for the retry button is a follow-up; the API and the warning text are in place.)

### Restock (GK-14)
Cancel/expiry/refund restocks **what was actually taken** per the stock ledger (every decrement and return for the order carries its id), not what was ordered; orders older than the ledger fall back to lines minus returned units.

### Phase-2 rules (GK-15)
`drizzle-pending/0043_phase2_constrain.sql` rewritten: every CHECK `NOT VALID` + `VALIDATE`, `NOT NULL` via a validated CHECK (no table scan under an exclusive lock), and the one-live-charge index now also leaves out `giftcard_*` rows — the old version would have refused every gift card + online/COD checkout. Still applied by you, after `phase2-verify.sql`.

### Duplicate and wrong payments (GK-16)
The PayMongo webhook now passes the paid amount and currency; `markOrderPaidByIntent` refuses a mismatch (row → `failed`, `Order.PaymentMismatch.V1` event) and never confirms a **second** charge on an already-paid order — that row is kept as `failed: duplicate payment`, a history note is written and `Order.DuplicatePayment.V1` is emitted so the seller refunds it.

### Coupons and referrals (GK-17)
Checkouts using the same coupon are serialised with a transaction-scoped advisory lock before the redemption count — the cap is now hard. Rewarded referrals whose order was refunded, cancelled or voided are clawed back (`clawBackReferrals()`, run at the start of `syncReferrals`): both store-credit cards are disabled with whatever is left on them and the referral is marked `reversed`. (Loyalty points already reverse on refund.)

### Guest checkout (GK-18)
A guest checkout matched by phone alone only fills blanks on the customer record; it never rewrites a known customer's name or email. What the buyer typed stays on the order.

### Courier webhooks (GK-19)
Deliveries are matched by **courier + courier order id**. Lalamove and Grab events older than 5 minutes (or from the future) are refused, so a captured signed "COMPLETED"/"CANCELED" can't be replayed. Grab's signature is now verifiable: from the `X-Grab-Signature`/`X-Grab-Timestamp` headers over the raw body, or, when it rides in the body, over the body **without its own `signature` member** (the old code hashed a body that contained the signature it was checking, so it could never match).

## Verified
- Local Postgres with 0044 applied: `packages/db` integration suite 213/213 incl. new `security-g2.test.ts` (COD not credited; parallel releases release once; partial refund debits, over-refund becomes owed and is paid down by the next credit; reconciliation flags a tampered balance; full refund records once, failed send retried once in parallel and sent exactly once, second refund refused; cancel restocks the two units still out, not three; wrong amount refused and duplicate charge flagged; guest checkout can't rewrite a customer). Unit suites: db 107/107, services 78/78 (new Grab/timestamp tests), admin 17/17, web 5/5.
- `tsc` clean in db, services, admin, web, platform; `next build` OK for all three apps.

## Still open (G3–G4)
Tamper-evident audit log (GK-20), ops 2FA bootstrap (GK-21), CI (GK-22), dependencies (GK-23), per-app secrets / workers.dev / token scope (GK-24), seed credentials (GK-25), payout-destination re-auth and masking bank numbers from staff.
