# Phase 18 — Agency partners + platform v1.1

**Before pushing:** run migration **0036_partners** on Neon (`pnpm --filter @gumakart/db migrate`).
If 0032–0035 haven't been run, `migrate` applies them first, in order.

0036 adds:

- a `partner` value on the `user_role` enum
- the `partners` and `partner_shops` tables
- `tenants.referred_by_partner_id`
- the `products_webhooks` trigger, which emits `product.created` and `product.updated`

The pending Phase 2 constraints are now `drizzle-pending/0037_phase2_constrain.sql` (journal idx 37).

There are no new secrets.

**Decisions (Sam, 2026-10-06):** no commission yet, and payouts will be decided later. Referrals are still
recorded, so a commission can be added later without guessing who referred whom.

## Agency partner program

### Partners

- Sign up at **admin.guma.one/partners/join**:
  1. Name, email and password.
  2. The emailed 6-digit code (the same code flow sellers use).
  3. Agency details.
- A new partner starts as **pending**.
- The partner signs in at the normal `/login` and lands on **/partner**. A partner login (with no shop) can only reach `/partner`.
- The /partner dashboard shows:
  - their **partner code** (`P-XXXXXX`)
  - their **referral link** (`/signup?partner=CODE`)
  - **client shops** with role, orders and sales for the last 30 days, and when they last opened the shop
  - shops that signed up with their link (name and date only: a referral doesn't give access)
- **Open** puts the partner inside the client's normal dashboard as the role the owner granted (Manager or Staff).
  - A blue banner says "Partner mode — … The owner sees what you do".
  - **Back to my shops** returns to /partner.
  - These sessions last up to 8 hours.

### Shop owners

- Owners manage this in **Settings → Partner** (owner only):
  1. Enter the code. The agency name, city and website show as soon as the code is complete.
  2. Pick Manager or Staff.
  3. Click **Give access**.
- Only one partner can have access at a time. **Remove access** cuts them off immediately.
- A shop that signed up through a partner's link sees "You signed up through X. Give them access?", answered with one click.
- What partners never get, even as Manager:
  - payment details
  - plan and billing
  - staff
  - API keys
  - partner settings

  These are the existing owner-only permissions, re-checked on every API call.
- The partner's actions show in **Settings → Activity** as "Maria Santos (Bida Digital, partner)" with their role. Grants and removals are logged too.
- The partner gets an email when access is granted (needs Resend; skipped otherwise).

### Ops

- **Platform Console → Partners** lists partners with:
  - status
  - code
  - shops with access
  - referred shops, with how many are on a paid plan (the basis for a future commission)
- Ops can **Approve**, **Suspend** (with a reason shown to the partner) or **Reactivate**.
- Suspending cuts the partner out of every client shop at once. Every action is in the audit log.

### Security model (for review)

- **Shop context lives in the JWT.** When a partner opens a shop, the JWT carries `role=seller_staff`, the granted `staffRole`, the shop, and `pa=<partnerId>`. `users.tenant_id` stays null, so tenancy never changes.
- **The grant is checked on every API call.** `requireTenantSession` calls `verifyPartnerAccess` each time. It requires all of the following:
  - the user is the partner's own login, with `role=partner` and status active
  - the partner is active
  - the grant is unrevoked, for that exact shop

  Anything else returns 403 `PARTNER_ACCESS_REVOKED`. The role comes from the database, not the JWT.
- **A revoked partner is moved out.** `/api/auth/session` returns the partner's own session once the grant is gone, and the dashboard sends them to /partner.
- **Fixes to session re-minting:**
  - Token re-minting (`/api/partner/exit`, and the partner branch of `/api/auth/session`) first checks the session version. A logged-out or revoked cookie can't mint a fresh one.
  - The same check was **added to the existing `/api/auth/session` re-issue path**. Before this phase, a stale-but-signed cookie could get a fresh cookie whenever its shop fields were out of date. That gap is closed.
- `/settings/partner` and `/api/shop-partner` are owner-only, and the routes also refuse partner and support sessions explicitly.

## Platform v1.1

- **New scope `products:write`** ("Update products"). It also grants `products:read`.
- **New endpoints:**

  | Endpoint | What it does |
  |---|---|
  | `POST /api/v1/products` | Adds a simple product (one variant). **Starts as draft.** Accepts title, price, compare_at_price, description_html, stock, sku, barcode and image_url. |
  | `PATCH /api/v1/products/{id}` | Changes title, description, price, compare-at price or status. It never deletes. For products with options, set prices per variant instead. |
  | `PATCH /api/v1/variants/{id}` | Changes price, compare-at price, SKU (must be unique in the shop) or barcode. The product's "from ₱X" price follows the cheapest active variant. |

  Every write is logged in Activity as `API · <key name>`.
- **New webhook events:** `product.created` and `product.updated`. They fire on title, price, description, category or status changes, and the payload is the full Product.
- The OpenAPI spec (`/api/v1/openapi.json`) is updated. The developers page picks up the new scope and events automatically.
- **Zapier/Make recipes:** `docs/INTEGRATIONS-RECIPES.md` has 9 recipes:
  1. Orders to Google Sheets
  2. Paid-order alerts
  3. Low-stock alerts
  4. Prices from a Sheet
  5. Stock counts
  6. Draft products from a form
  7. Daily summary
  8. Customer to CRM
  9. Catalog feed

  They use the generic Webhooks and HTTP blocks, so no marketplace listing is needed.
- **Help centre:** two new Taglish articles, "Agency o VA na tutulong sa shop mo" and "Ikonekta sa Google Sheets, Slack o Telegram".

## Bugs fixed along the way

- **Title-only product edits failed.** `updateProductForTenant` threw "No values to set" when an edit changed only the title, description or status of a product without options. This is now covered by a test.
- **Session re-mint gap** (described in the security model above).

## Tests

- **Integration:** `src/partners.test.ts` (10 tests). It covers:
  - codes and referrals (once only; unknown and suspended codes are ignored)
  - pending partners can't be granted
  - grant, verify and role change
  - one partner per shop
  - fail-closed checks (wrong user, wrong shop, other partner)
  - revoke, re-grant, partner suspend and user suspend
  - dashboard stats only for shops with access
  - ops counts
  - API create, update and variant writes, including validation and cross-shop isolation
  - product webhooks and their payload
- **Unit:** partner settings are owner-only (`staff-permissions.test.ts`).
- **Totals:** unit 104, integration 161, auth 9, services 73, all passing. Typecheck is clean in 5 packages. Admin, platform and web production builds pass.
- **Browser, end to end:**
  1. Partner signs up and shows as pending.
  2. Ops approves.
  3. Owner previews the code and grants Manager.
  4. Partner sees the shop with its stats, opens it, and the banner and Manager badge show.
  5. Partner is redirected away from Payments and Partner settings. `/api/shop-partner`, `/api/staff` and `/api/developers/keys` all return 403.
  6. The partner's edit shows labelled in Activity.
  7. Owner revokes: the partner's next API call returns 403 and the dashboard moves them to /partner.

## Honest limits

- **No commission or payouts** (by decision). The referral data is ready when you decide.
- **One partner per shop at a time.** A shop with two agencies would need to pick one.
- **Partners can't reset a forgotten password themselves.** There's no forgot-password flow for any role yet. Ops can help.
- **The referral is set at signup only.** It can't be added later, and the first code wins.
- **Partners can't create shops for clients.** The client signs up (ideally with the partner's link) and then grants access.
- **API products are simple products only.** Options and variants are created in the dashboard; after that, their prices, SKUs and stock can be managed through the API.
- **There's no official Zapier or Make app**, only recipes using their generic Webhooks and HTTP blocks.
