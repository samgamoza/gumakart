# Security slice G4 — edge and pipeline (2026-10-09)

Source: the three-app security audit of 2026-10-07 (project doc `claude/security-audit-2026-10-07.md`), Guma Kart findings GK-10, GK-21, GK-22, GK-23, GK-24, GK-25.

**No migration.** **Deploy:** all three apps (headers, Next 15.5.27, workers.dev off). The deploy workflow now has a `verify` job in front of `deploy`.
**Before the next deploy (you):**
1. Make a **Guma Kart-only Cloudflare token** (Workers Scripts:Edit, Workers R2 Storage:Read, Workers Routes:Edit + Zone:Read on guma.one; no DNS:Edit) and put it in this repo's `.env` as `CLOUDFLARE_API_TOKEN`; update the `CLOUDFLARE_API_TOKEN` repo secret too. Revoke the shared Kuya Eddie token's use here.
2. Run `scripts/deploy-cloudflare.ps1` once — it now writes **per-app secrets** and removes from each Worker the ones it must not hold (see the `$DenyByApp` table in the script).
3. If the `simply-sweet` seller account exists on Neon, rotate its password (the old one was in the repo).
4. Dashboard checklist (not code): Cloudflare WAF managed rules + rate rules on the three hosts; HSTS preload for guma.one when every subdomain is HTTPS; Cloudflare Access in front of ops.guma.one; GitHub secret scanning + Dependabot; branch protection on `main` with the `verify` job required.

## What changed

### Headers (GK-10) — all three `next.config.ts`
`poweredByHeader: false`; on every path: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a per-app `Permissions-Policy` (admin keeps the camera for POS scanning), HSTS (1 year, includeSubDomains), COOP. **Enforced CSP** = the part that cannot break the app: `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://accounts.google.com` — nobody can frame ops or admin. The **full CSP runs report-only** (Next.js hydration needs inline scripts until nonces are wired; allow-lists for Google Tag Manager/Maps/sign-in, Facebook and TikTok pixels on the storefront, PayMongo checkout). Watch consoles for a week, then move it to `Content-Security-Policy`. On the storefront, order pages (`/:shop/orders/*`) and `/account/*` send `Referrer-Policy: no-referrer`, so the `?t=` order token never leaks through a seller's tracking pixel or a link.

### Ops 2FA bootstrap (GK-21)
Enrolling an authenticator on an ops admin who has none now needs the password **and a one-time code emailed to the account** (`issueEmailCode(…, "enroll")`): the start step emails it, the confirm step verifies both codes. A password-only attacker can no longer enrol their own device. The ops login form asks for both codes.

### CI (GK-22)
`deploy-cloudflare.yml`: `permissions: contents: read`; actions pinned by SHA; a `verify` job (typecheck, unit tests, route-auth audit, `pnpm audit --prod` at critical, gitleaks) that `deploy` **needs**; `cancel-in-progress: false` so a newer push waits instead of cancelling a running deploy (the three apps never end on different versions). `brand-guard.yml` pinned and least-privilege too.

### Dependencies (GK-23)
Next **15.5.27** in all three apps and as a root override (the transitive copy under inngest too) — clears the two RCE criticals and three highs. `shadcn` (a CLI) and `@imgly/background-removal-node` (dev-only ONNX fallback, spawned as a separate process) moved out of runtime dependencies. Root `pnpm.overrides` pin `proxy-addr`, `undici`, `fast-uri`, `sharp` 0.35.5, `postcss`, `nanoid`, `browserslist`, `@grpc/grpc-js`, `source-map-js`, `brace-expansion`. `pnpm audit --prod`: **0 critical, 2 high** left (drizzle-orm 0.38 — the advisory isn't reachable here and 0.45 is a breaking upgrade; and a postcss copy inside Next's own bundle) from 3 critical / 48 high.

### Secrets and URLs (GK-24)
- `workers_dev: false` and `preview_urls: false` on all three Workers: only the custom domains answer, behind the zone's WAF and rate rules.
- `scripts/deploy-cloudflare.ps1` uploads **per-app secrets** (`$DenyByApp`): the public storefront never holds `CRON_SECRET`, ops alerts, Meta/Shopee/Lazada, remove.bg, waybill, channel-token or TOTP keys, wallet switches or backup URLs; ops never holds courier, storefront-preview, SMS opt-out, VAPID private, Inngest, Blob or webhook secrets. Keys an earlier deploy put on a Worker are deleted.
- The script no longer edits DNS (it only warns about a leftover tunnel CNAME) and no longer borrows the Kuya Eddie token — so the token can be narrow (see the script header).

### Seed credentials (GK-25)
`seed-simply-sweet.ts` takes `SEED_SIMPLY_SWEET_PASSWORD` from the environment (12+ chars) and prints nothing secret.

## Verified
- `tsc` clean in db, services, auth, admin, web, platform; `next build` OK for all three on Next 15.5.27 (Google Fonts mocked in this sandbox — the proxy stopped allowing fonts.googleapis.com mid-session; nothing else changed). Unit suites: db 107/107, services 78/78, admin 17/17, web 5/5, auth 18+. `pnpm audit --prod --audit-level=critical` exit 0.

## Still open / follow-ups
- Move the report-only CSP to enforced after a week; add nonces to drop `'unsafe-inline'` later.
- Payout-destination change re-auth and masking bank numbers from staff (small items from the audit) — not done in this slice.
- KYC phone link expiry after approval — not done.
- drizzle-orm 0.45 upgrade (breaking) when convenient.
