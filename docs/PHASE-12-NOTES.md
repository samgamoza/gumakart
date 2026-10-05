# Phase 12 — Guma ID (buyers recognised at every Guma Kart shop)

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 12). Migration **0029_guma_id** must run on
Neon **before pushing**. Pending Phase 2 constraints are now `drizzle-pending/0030_…`.
**Ready to hook up:** Guma ID turns on when the web Worker has `GUMA_ID_SECRET` (or `AUTH_SECRET`)
**and** `SEMAPHORE_API_KEY` (see `docs/GO-LIVE.md` §6). Until then every Guma ID surface says
"Malapit na" or stays hidden, and checkout works exactly as before (no account needed — still
true after it's on). `pnpm install` is needed once (the web app now depends on `@gumakart/auth`).

## What shipped

- **Sign in with a text code** (kart.guma.one/account, and inside checkout): mobile number → 6-digit
  code → in. No password. First use creates the Guma ID. Taglish copy.
  - Codes: 6 digits, 5 minutes, 5 tries, 3 per 15 min and 10 per day per number, plus per-IP
    limits; stored only as a keyed hash; a new code cancels the old one.
  - Session: own signed cookie (separate key from seller/POS cookies), 90 days, "sign out on all
    devices" bumps a version.
  - Local dev (no Semaphore key): the labeled SMS mock shows the code on screen as "Test mode".
    Never in production.
- **One-tap checkout**: on checkout links and the online store, a signed-in buyer gets name, number,
  default address and favourite payment filled in; a picker switches saved addresses; new addresses
  are offered to be saved after the order. Not signed in → a small "May Guma ID ka?" bar.
- **"Mga order"**: every order placed with the verified number across **all** Guma Kart shops —
  status in Taglish, total and refunds, "Tingnan" (order page) and "Order ulit" (back to the same
  checkout link or shop). Orders placed while signed in are also linked to the account (only when
  the number on the order is the buyer's).
- **Address book** (up to 10, default), **profile** (name, email, favourite payment),
  **reminder texts per shop** (turns marketing/reminder SMS off for that shop; order updates still
  come), **privacy**: download my data (JSON), sign out, sign out everywhere, delete my Guma ID.
- **Order page prompt**: after ordering, "Mas mabilis sa susunod" offers to verify the number; if
  signed in, a link to all orders.
- **Ops metrics**: share of online orders placed with Guma ID and number of accounts (Metrics →
  Retention) — the roadmap's exit measure (≥30% of repeat buyers).

## Privacy design
- Shops never read Guma ID data. A shop sees only what's on that shop's order (unchanged).
- Delete removes the account, addresses and codes; the shops keep their orders (they need them for
  their records), unlinked from the buyer.
- `account` and `guma-id` are now reserved shop URLs.

## Honest limits
- OTP needs Semaphore; there's no email-code fallback yet.
- Saved addresses pre-fill the checkout-link form fully; the online-store form gets street, barangay
  and city/province (it uses a different address picker).
- POS sales aren't listed under "Mga order" (walk-in receipts aren't tied to a number reliably).

## Tests
- Integration `guma-id.test.ts` (8): phone normalising, code hash + single use, wrong-try lockout,
  rate limit and expiry, keyed hash, addresses/default/limit/ownership, orders across shops and
  never someone else's, reminders per shop, export and delete.
- db unit 68 ✓ · db integration 93 ✓ · auth 9 ✓ · typecheck clean · admin, web, platform builds ✓.
  Browser check: sign in with the test code, orders across shops, profile, checkout pre-fill.
