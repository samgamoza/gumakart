# Phase 10 — Staff, roles and activity log

Roadmap: project doc `claude/gumakart-roadmap.md` (Phase 10). Migration **0027_staff** must run on
Neon **before pushing** (`pnpm db:migrate` with the Neon `DATABASE_URL`, like 0025/0026). Additive
only. Pending Phase 2 constraints are renumbered to `drizzle-pending/0028_phase2_constrain.sql` at the time (now 0029).
No new secrets. Invite emails use Resend when `RESEND_API_KEY` is set; until then the owner gets the
link to send by Messenger/Viber/SMS (ready to hook up, never a fake "sent").

## What shipped

### Staff accounts and invites — Settings → Staff & roles
- The owner invites by email with a role. A **single-use link (7 days)** is shown to copy or SMS;
  it's emailed too once Resend is on. Only a SHA-256 of the token is stored.
- `/invite/<token>`: the person sets their name and a password (or signs in with the password of an
  existing Guma account with that email) and lands in the shop — cashiers go straight to POS.
- One account = one shop (same as owners). Someone who runs or works in another shop can't be invited.
- Change role or remove: the person is **signed out everywhere at once** (session version bump).
  Removed staff keep their name in the activity log; they can be re-invited later.
- **POS PIN as quick unlock**: Staff & roles → "POS PIN" links a PIN to the account; the PIN's POS
  role follows the account. PIN-only cashiers (no login) still work as before.

### Roles (enforced on the server)
| | Owner | Manager | Staff | Cashier |
|---|---|---|---|---|
| Orders: see, pack, ship, book riders | ✓ | ✓ | ✓ | |
| Checkout links, chats, customers | ✓ | ✓ | ✓ | |
| POS | ✓ | ✓ | ✓ | ✓ |
| Confirm/reject payments, cancel, refund | ✓ | ✓ | | |
| Products, prices, stock | ✓ | ✓ | view | |
| Shop settings, delivery, marketing, POS setup | ✓ | ✓ | | |
| Activity log | ✓ | ✓ | | |
| Plan, billing, payouts, payment accounts, staff | ✓ | | | |

- One rule table (`packages/db/src/types/staff-permissions.ts`) maps every seller API path + method
  to a permission. `requireTenantSession` checks it against the role **read from the database** on
  each request. Middleware stamps the real path/method on the request (overwriting anything the
  client sent); without it, staff are refused. **A route no rule covers is owner-only**, so new
  endpoints are safe by default.
- Finer checks inside routes: cancel and reject-payment in the order actions; payment settings and
  payout details in Settings (payout details are hidden from non-owners).
- The admin hides what a role can't use (nav, settings menu, order money buttons, product edit
  buttons, stock import/count) and redirects pages they can't open — display only; the API is the
  boundary.

### Activity log — Settings → Activity (owner + manager)
Logged with name and role: payment confirmed/rejected, order accepted/packed/shipped/delivered/
cancelled, refunds, product added/deleted, price and stock changes (before → after), sizes/colours
saved, stock counts and CSV imports, settings changes, checkout links made, POS shift closed
(over/short), POS cashiers added, staff invited/joined/role changed/removed/PIN set. Filter by kind
and person. Logging never fails the action it records.

## Honest limits
- Sign-in is email + password. **Mobile + OTP login waits for Semaphore** (same switch as SMS).
- COD "cash received" is a payment confirmation, so it's manager/owner only; make a packer a
  manager if they collect cash.
- POS sales stay in the POS sales list rather than the activity log (too many rows); shift close is
  logged.
- The legacy "sweet" dashboard tabs (one template's shell) don't filter by role; pages and APIs
  still block access.

## Tests
- Unit: `staff-permissions.test.ts` (12) — role matrix, money endpoints, cashier POS-only,
  owner-only billing/staff, unknown route → owner-only, page rules.
- Integration: `staff.test.ts` (9) — invite/accept, token stored hashed, single use, revoke,
  expiry, replace, other-shop refusal, existing-account acceptance, role change signs out and moves
  the PIN role, removal keeps history and disables the PIN, re-invite, activity filters and
  shop scoping.
- db unit 67 ✓ · db integration 73 ✓ · typecheck clean (db, auth, services, admin, web, platform) ·
  admin production build ✓. Browser check: staff gets 403 on confirm-payment, product create and
  /api/staff; `/settings/shop` redirects; cashier lands on POS and `/orders` sends them back.
