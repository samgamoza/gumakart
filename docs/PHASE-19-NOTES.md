# Phase 19 — Go-live hardening

There's **no migration** and no new secret. Before pushing, Neon still needs 0032–0036 (`pnpm db:migrate`).

## 1. Forgot password (sellers, staff, partners)

- **Flow:**
  1. On `/login`, "Forgot password?" opens `/forgot-password`.
  2. The person enters their email and receives a 6-digit code.
  3. They enter the code and a new password, and are signed in.
- **Signs out everywhere else.** The reset bumps `session_version`, so every other session for that account ends. The account owner then gets a "your password was changed" email (needs Resend).
- **Reuses the existing email-code system.** Codes are HMAC-hashed, last 10 minutes, are single-use and allow 5 attempts. The new purpose is `reset`, which uses the existing varchar column, so no migration is needed.
- **No account discovery.** `/api/auth/password/forgot` gives the same answer for every email, including during the resend cooldown.
- **Rate limits:**

  | What | Limit |
  |---|---|
  | Code requests per IP | 8 per hour |
  | Code requests per email | 5 per hour |
  | Reset attempts per IP | 15 per 15 minutes |

- **Weak passwords don't burn the code.** Password strength is checked before the code is consumed.
- **Who can reset:**
  - Only active `seller_owner`, `seller_staff` (still in a shop) and `partner` accounts.
  - Buyers, ops admins, removed staff and suspended accounts get no code. A code issued before a suspension stops working.
  - A Google-only account can set a password this way, since the code proves they own the inbox.
- **Tests:** `packages/auth/src/password-reset.test.ts` (4 integration tests; `pnpm --filter @gumakart/auth test:integration`).

## 2. Route auth audit (runs in CI before every deploy)

- **Where:** `scripts/route-audit.test.mjs`. It has no dependencies; run it with `pnpm test:routes` or `node --test scripts/route-audit.test.mjs`.
- **How it reads the code:**
  - It strips comments, so a guard mentioned only in a comment doesn't count.
  - It checks each exported handler's body and follows calls into same-file helpers. A guarded GET can't hide an open DELETE next to it.
  - Braces inside return types are skipped correctly.
- **Rules per app:**

  | App | Rule |
  |---|---|
  | Admin (186 routes) | Every handler calls a guard: `requireTenantSession`, `requirePartner`, `requirePosActor`/`requirePosOwner`, `withApi`, `isCronAuthorized`, or a checked session. Otherwise it's in `ADMIN_PUBLIC` with a reason; that entry is the review. Stale entries fail the test. |
  | Web (buyer site) | Every write (POST/PUT/PATCH/DELETE) is rate-limited, signature-checked, or needs a Guma ID buyer. `/api/id/*` needs a signed-in buyer (except sign-in itself). |
  | Ops | Every server action calls the super-admin guard (server actions are public POST endpoints). Every page except `/login` calls `requireSuperAdmin`. |

- **Proven to catch a real gap:** a planted unguarded DELETE next to a guarded GET, with a commented-out guard, failed the audit.
- **Found and fixed along the way:** the 11 copy-pasted cron guards (plain `===` compare) are now one shared `lib/cron-auth.ts` with a constant-time compare.
- **Nothing was found open.** Every flagged item was either guarded, which the parser now understands, or public by design: the KYC link token and the VAPID public key.
- **CI step:** "Route auth audit" in `.github/workflows/deploy-cloudflare.yml`.

## 3. Deploy safety: code never ships ahead of its migration

- **`pnpm db:status`** (read-only). Point `DATABASE_URL` at Neon. It lists applied and pending migrations and exits with 1 if anything is pending. Run it before pushing.
- **`GET admin.guma.one/api/health/schema`** (public, booleans only):
  - `?when=<journal when>` returns `{ applied }`
  - with no parameter it returns `{ upToDate }` for the running code
- **CI step:** "Database has this commit's migrations". It runs before install and build, and asks the **live** admin app (which shares the database) whether Neon has the newest migration in the commit being deployed.
  - **Pass:** the migration is applied, so the deploy continues.
  - **Fail:** the migration is missing. The deploy stops with: *"Neon is missing migration X. Run 'pnpm db:migrate' against Neon, then re-run this workflow."*
  - **Warn:** the live app can't answer yet, which happens on **the first deploy of this phase**, because the live app doesn't have the endpoint. The deploy continues.
  - No database credentials are needed in CI.
  - Emergency override: run the workflow manually with "skip_schema_check".
- **`MIGRATION_HEAD`** (`packages/db/src/migration-head.ts`) names the newest migration the code needs. `migration-journal.test.ts` fails if it isn't updated with a new migration.
- All three branches (applied, missing, can't answer) were exercised against the local server with the real workflow script.

## 4. Smoke suite (money paths, real browser)

- **Where:** `e2e/smoke.mjs`. It's its own package outside the pnpm workspace, so CI and the lockfile are unaffected.
- **First-time setup:**

  ```
  cd e2e && npm install && npx playwright install chromium
  ```

- **Run it:**

  ```
  SMOKE_SELLER_EMAIL=… SMOKE_SELLER_PASSWORD=… npm run smoke
  ```

  - Defaults: `localhost:3001` (admin) and `localhost:3010` (web).
  - Set `SMOKE_ADMIN_URL` and `SMOKE_WEB_URL` for staging.
  - `SMOKE_VERBOSE=1` shows each action; `SMOKE_HEADED=1` shows the browser.
- **Steps:**
  1. Seller signs in.
  2. Seller adds a product.
  3. Seller creates a pickup checkout link.
  4. Buyer orders with **cash on pickup**.
  5. Buyer orders with **GCash** and uploads a screenshot as proof.
  6. Seller accepts the COD order and confirms the GCash payment.
  7. **POS:** opens a shift, sells, and prints a receipt.
  8. **POS:** returns the sale with a cash refund.
  9. **Cleanup:** archives the product and turns off the link (also runs when a step fails).
- **Safety:** it refuses to run against `*.guma.one` unless `SMOKE_ALLOW_LIVE=1` is set, because it places real orders. Use a test shop. The shop needs GCash (manual) and pickup turned on.
- **On failure:** a screenshot goes to `e2e/out/`, and the run summary to `e2e/out/last-run.json`.
- **Last local run:** 8/8 steps passed. The orders it created checked out in the database: the COD order is due on pickup and the GCash order is paid. The product was archived and the link turned off.

## Also fixed

- **Flaky integration test.** `fanOutWebhookEvents()` processes every shop's events, and test files run in parallel. The developer test's "each event fans out once" could pick up the partners test's product events. Tests now fan out only their own shop (an optional `tenantId` parameter); this is also the likely cause of the one-off failure seen in Phase 17b. 5/5 clean runs afterwards.

## Tests

| Suite | Result |
|---|---|
| db unit | 105 |
| db integration | 161 |
| auth unit | 9 |
| auth integration | 4 |
| admin | 14 |
| services | 73 |
| route audit | 8 |
| smoke | 8/8 steps |

Typecheck is clean in 5 packages. Admin, platform and web production builds pass.

## Honest limits

- Ops (platform) admins still have no self-serve password reset. That's deliberate for the highest-privilege accounts; ops resets them in the database.
- The smoke suite isn't in CI: it needs a test shop and a seller login. Run it locally, or against staging before big releases.
- The route audit is static analysis. It proves a guard is called, not that the guard is the right one; role rules stay in `staff-permissions` and its tests.
- The first deploy after this phase only warns on the schema check (the live app doesn't have the endpoint yet). From the next deploy on, it blocks.
