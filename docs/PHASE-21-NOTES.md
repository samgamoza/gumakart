# Phase 21 — Two-step sign-in, account security, last theme images

**One migration:** `0037_two_factor` (journal idx 37). It only adds four columns to `users`; nothing else
changes. Run it on Neon before pushing (`pnpm db:status`, then `pnpm --filter @gumakart/db migrate`).
The pending Phase 2 constraints were renumbered to `drizzle-pending/0038_phase2_constrain.sql` (journal idx 38).

**No new secret is needed.** The authenticator secrets are encrypted with a key derived from `AUTH_SECRET`.
You can set `TOTP_ENCRYPTION_KEY` (32+ characters) to use a separate key instead.

> ⚠️ If `AUTH_SECRET` (or `TOTP_ENCRYPTION_KEY`) ever changes, every saved authenticator stops working.
> Everyone with 2FA must then be reset (see Recovery below) and set it up again. Rotating `AUTH_SECRET`
> already signs everyone out, so do both together.

## 1. Ops console (ops.guma.one): two-step sign-in is required

- **Sign-in is now two steps.** A correct password alone no longer opens the console. It sets a 5-minute
  "2FA ticket" cookie, and the next screen asks for the 6-digit code from an authenticator app.
- **First sign-in after deploy.** Every super-admin is walked through setup: scan the QR, type the code,
  save 10 backup codes, then the console opens. **Have your phone ready when you first sign in after
  this deploy.**
- **Everyone is signed out once.** Existing ops sessions don't carry the "two-step passed" mark, so all
  ops admins sign in again after the deploy.
- **Ops guards are stricter:**
  - Every page and server action now also checks the session version in the database. "Sign out
    everywhere" and a password change take effect immediately.
  - Before, an ops token stayed valid for its whole lifetime.
- **Rate limits:**
  - Ops password: 10 tries per IP per 5 minutes, and 10 per email per 15 minutes.
  - Codes: 10 per account and 30 per IP per 15 minutes.
  - Before this phase, the ops login had no limit at all.
- **No account discovery.** The ops login gives the same "Invalid email or password" for "no such
  account", "not an admin" and "wrong password".
- **Ops → Settings → "Your sign-in":** see how many backup codes are left, make new ones (needs a
  current code), and sign out everywhere.
- **Audit log entries:** `ops_sign_in`, `ops_sign_in_backup_code`, `ops_2fa_enrolled`,
  `ops_2fa_backup_codes_regenerated`, `ops_signed_out_everywhere`.
- **2FA can't be turned off for ops accounts** from the console.

## 2. Sellers, staff and partners: optional 2FA, plus a working password page

- **Settings → Account** ("Password & security") has these sections:
  - **Two-step sign-in:** turn on (QR → code → backup codes), new backup codes, turn off. Changing
    backup codes or turning it off needs a current code.
  - **Change password:** this form was a non-working placeholder until now. It now:
    - needs the current password and rejects weak ones
    - signs out every other device
    - emails a notice (when Resend is set)
  - **Sign out other devices.**
- **Partners** get the same two-step card at the bottom of their partner dashboard.
- **When 2FA is on, every way in asks for the code:**

  | Way in | What happens |
  |---|---|
  | Password | The code step comes next. |
  | Google sign-in | Proves step one only. The person lands on the code step. |
  | Forgot password | The new password is saved, then the code step. An emailed code is not a second factor. |
  | Email verification link | No longer signs a 2FA account in. It sends the person to sign in. |
  | Staff invite (existing account) | Same: the code step. |

- **A stolen session can't swap the phone.** Setup can't be restarted while 2FA is on; it must be
  turned off with a valid code first.
- **Support access:** an ops "support access" session can't view or change a seller's 2FA or password.
- **Help article:** "Two-step sign-in (2FA)" in Help.

## 3. How it works

| Piece | Where |
|---|---|
| TOTP (RFC 6238: SHA-1, 30 s, 6 digits, ±1 step), backup codes, sealing | `packages/auth/src/totp.ts` (WebCrypto; runs in Workers) |
| Enrollment, code check, 2FA ticket | `packages/auth/src/two-factor.ts` |
| Ops sign-in | `apps/platform/app/api/auth/login`, `…/2fa/verify`, `…/2fa/enroll`, `lib/ops-sign-in.ts` |
| Ops guard | `apps/platform/lib/session.ts` (needs the `mf` claim and a current session version) |
| Seller sign-in gate | `apps/admin/lib/two-factor-sign-in.ts` (login, Google, reset, invite); `/api/auth/2fa/verify` |
| Seller settings | `/api/account/two-factor`, `/api/account/password`, `/api/account/sign-out-others` |

- **What is stored.** The secret is AES-GCM encrypted. Backup codes are stored only as keyed hashes
  (HMAC), so a database leak alone doesn't reveal them.
- **A code works once.** An app code's 30-second step is claimed with a conditional `UPDATE`, so the
  same code can't sign in twice. A backup code is removed the moment it's used, and two requests racing
  with one code can't both win.
- **The 2FA ticket:**
  - It's a signed JWT with `purpose: "mfa"`. Session checks refuse any token with a `purpose`, so a
    ticket can never act as a session.
  - It names its app: an admin ticket doesn't work on ops.
  - It carries the session version, so "sign out everywhere" also cancels a half-finished sign-in.
  - It stores where to go next, but only same-site paths are kept.
- **Route audit (`pnpm test:routes`)** has a new rule:
  - Only the ops 2FA routes may create an ops session, and only after checking the ticket and a code.
  - The ops guard must require the two-step mark and the session version.
  - `/api/auth/2fa/verify` (admin) is on the public list with its reason.

## Recovery: lost phone and lost backup codes

This needs database access (Neon SQL editor) by someone who can reach Neon. Check who is asking
before doing it.

```sql
-- Turn 2FA off for one account (they set it up again at next sign-in; ops admins are forced to).
UPDATE users
SET totp_secret_sealed = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_backup_codes = '[]'::jsonb,
    session_version = session_version + 1     -- also signs them out everywhere
WHERE email = 'person@example.com';
```

For sellers, support can do this after verifying the shop owner, for example from the email on file
plus a recent order number.

## 4. Remaining theme images

The last full-size theme images were CSS backgrounds. They now request a resized copy of about
1200 px (`sizedImageUrl`):

- the Haircut and Studio slides
- the Organic and Mellow heroes
- the Furnish quote banner
- the shop cover in the shared theme shell

Every other theme image already goes through `next/image` with a `sizes` hint, so the Phase 20 IMAGES
binding resizes it. The sweep found no plain `<img>` left without a sized URL.

## Verified

- **Ops in a real browser** (local production build):
  1. Password → forced setup, and the console stayed closed (`/settings` → `/login`) until the code.
  2. A wrong code was refused.
  3. The right code → 10 backup codes → console.
  4. Signed out and back in: the code that turned 2FA on was refused as a replay, and a backup code
     worked.
  5. Settings showed "Your sign-in".
- **Seller in a real browser:**
  1. Turned 2FA on in Settings → Account.
  2. Signed out, then signed in with the password: no session cookie, only the ticket, and
     `/api/orders` → 401.
  3. Entered the code → dashboard.
  4. A wrong current password was refused on Change password.
  5. Turned 2FA off with a backup code (test account restored).
- **Tests:**

  | Suite | Result |
  |---|---|
  | auth unit (new `totp.test.ts`: RFC 6238 vectors, replay, sealing) | 18 |
  | auth integration (new `two-factor.test.ts`, 16 cases incl. racing backup codes) | 20 |
  | db unit / integration | 105 / 161 |
  | admin | 14 |
  | web | 3 |
  | services | 73 |
  | route audit | 9 |

- Typecheck is clean in 6 packages. Admin, platform and web production builds pass.

## Not done / follow-ups

- **No SMS or email codes as a second factor, on purpose.** SIM-swap makes SMS weak, and email is
  already the password-reset channel. Authenticator apps plus backup codes are the standard.
- **Seller 2FA is optional.** A later phase could require it for shop owners above a sales threshold, or
  for staff with the Manager role.
- **Passkeys (WebAuthn)** would be the next step up. They aren't needed for launch.
