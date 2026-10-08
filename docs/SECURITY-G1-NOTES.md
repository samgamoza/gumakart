# Security slice G1 — close the holes in the app code (2026-10-08)

Source: the three-app security audit of 2026-10-07 (project doc `claude/security-audit-2026-10-07.md`), Guma Kart findings GK-1, GK-2, GK-3, GK-4, GK-5, GK-7, GK-8, GK-9, GK-11, GK-12 and the P3 items (error messages, Google verified email, health page, middleware path).

**Migration:** `0043_security_g1` (two small tables, no rewrites) — `pnpm db:migrate` against Neon **before** pushing; `MIGRATION_HEAD` now points at it, so a build deployed ahead of the migration reports itself on the ops health page.
**Deploy:** all three apps (web, admin, platform). No new secrets. Optional env: `NEXT_PUBLIC_IMAGE_HOSTS` (extra image hosts, web) and `PRODUCT_UPLOAD_HOSTS` (admin) — only needed if photos ever live somewhere other than Vercel Blob / R2.

## What changed

### Stored script injection in SEO JSON-LD (GK-1)
`safeJsonLd()` escapes `<`, `>`, `&` and the two Unicode line separators as `\u` sequences before the structured data goes inside `<script type="application/ld+json">`. A seller's `</script>` is now inert text; crawlers still get valid JSON.

### Rate limits that hold (GK-2)
- **Client IP:** `cf-connecting-ip` first (Cloudflare sets it and overwrites anything the client sent), then `x-real-ip`, then `x-forwarded-for`. A forged header no longer gives every request a fresh identity.
- **Shared counter:** new `rate_limits` table; every hit is one atomic UPSERT (`dbRateLimitHit`), so all Worker isolates share one count. Registered from each app's `instrumentation.ts` (`registerSharedRateLimitBackend`, kept on `globalThis` because Next bundles the package separately per route). Upstash still wins when configured; memory is the last resort only.
- **Per-account login lock:** 8 wrong passwords for one email in 15 minutes locks that email whatever the IP (`rateLimitBlocked` checks without spending; failures charge the key). Ops login already had this.
- Expired windows and used tokens are swept on the hourly ops cron tick.

### Atomic code counters (GK-3)
`verifyEmailCode` counts a miss with `UPDATE … SET attempts = attempts + 1 WHERE attempts < 5` and re-checks the cap before accepting a right code, so parallel guesses can't all pass. (Buyer OTPs were already row-locked.)

### POS offline price guard (GK-4)
An offline sale sent **below** the catalogue price is refused (`PRICE_BELOW_CATALOG`) and lands in Settings → POS → Offline sales for the owner, unless the product was edited after the sale was rung (the register was holding an older price — still recorded and flagged as before). A price **above** the catalogue is never refused.

### Suspension ends every session (GK-5)
- `setUserStatus` / `setUserRole` bump `session_version`; `isSessionCurrent` also refuses suspended/removed accounts outright.
- Google sign-in refuses suspended or removed accounts, and refuses addresses Google hasn't verified.

### Abandoned-cart texts only to proven numbers (GK-7)
- A checkout session only arms recovery texts when the number is the signed-in Guma ID's verified phone or has ordered at that shop before. A stranger's number with a ticked box gets nothing.
- Platform-wide ceiling per phone per 24 h in `sendWithLog`: 3 marketing, 15 transactional; the rest are logged as `suppressed / daily_cap`.

### Verification link (GK-8)
The emailed link now only marks the address verified — single use, never signs anyone in; the token is never written to the logs. The console's real flow is the 6-digit code; the link path just lands on `/login?verified=1`.

### Single-use support access (GK-9)
Grants carry a `jti`, live 90 s (was 5 min) and are recorded in `consumed_tokens` on redemption (`consumeTokenOnce`, insert-as-lock). A second use of the URL from history or a log is refused.

### Image proxy and photo fetch (GK-11, GK-12)
- `images.remotePatterns` is now the allow-list in `apps/web/lib/image-hosts.ts` (Vercel Blob, Unsplash, `NEXT_PUBLIC_IMAGE_HOSTS`); OpenNext enforces it on `/_next/image`. A custom loader passes any other remote image through untouched, so nothing breaks — our optimiser simply never fetches it.
- "Enhance / fill from photo" only fetches `https://` URLs on our upload host under `/products/<tenant>/`, with no redirects, a 10 s limit, an image content type and the 5 MB ceiling.

### Smaller items
- Four admin routes no longer echo internal error text on 500.
- `/api/health/integrations` (web and admin) answers in full only with the cron bearer; everyone else sees `{ ok: true }`.
- The admin/platform middleware no longer skips `/api/…png`-style paths.

## Verified
- Typecheck clean in all packages and apps; `next build` OK for web, admin and platform.
- Unit tests: `apps/web` (JSON-LD escape, image allow-list, loader), `packages/db` 107/107, `packages/auth` 18/18, `packages/services` 76/76.
- Integration (local Postgres, 0043 applied): `packages/db` suite 205/205 incl. new `security-g1.test.ts` — 30 parallel hits count exactly 30 with no lost increments, a peek doesn't spend, an expired window restarts at 1; a one-shot token wins exactly once under 8 parallel redemptions; a number stops at 3 marketing texts a day. POS offline tests cover the new price guard both ways.
- Live smoke on the admin build: 8 wrong passwords from 10 different source IPs → the 9th and 10th are 429 "Too many wrong passwords for this account", and the counts are rows in `rate_limits`, not process memory.

## Still open
G2 (wallet/money integrity), G3 (tamper-evident audit), G4 (headers, CSP, CI, deps) and G5 per the audit report. Sign-up still says when an email is taken (your chosen UX); it is behind the 8/hour per-IP limiter and the shared counter now makes that real.
