# Deploying Guma Kart to Cloudflare Workers

All three Next.js apps run on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare),
like Kuya Eddie. Proxmox CT 106 is no longer needed for Guma Kart once this is live
(`deploy.ps1` still targets it, for rollback or a later move back).

| App | Worker | Hostname | Extras |
|---|---|---|---|
| `apps/web` (storefront + `/kart`) | `gumakart-web` | kart.guma.one | R2 `UPLOADS` |
| `apps/admin` (seller admin) | `gumakart-admin` | admin.guma.one | R2 `UPLOADS`, cron every 5 min |
| `apps/platform` (ops console) | `gumakart-platform` | ops.guma.one | — |

## Build on Linux, not Windows

`@opennextjs/cloudflare` writes Windows paths (`.next\routes-manifest.json`) into the bundle when it
builds on Windows, and the deployed Worker then answers **500 on every page**. So builds run on
GitHub Actions (`.github/workflows/deploy-cloudflare.yml`, Ubuntu): every push to `main` / `wip/**`
that touches `apps/`, `packages/` or the lockfile deploys all three, and **Actions → Deploy Guma Kart
(Cloudflare) → Run workflow** deploys on demand. Repo secret needed: `CLOUDFLARE_API_TOKEN`
(optional `CLOUDFLARE_ACCOUNT_ID`). On Windows the PowerShell script below only does settings,
DNS cutover and Worker secrets (use `-ForceLocalBuild` only from WSL/Linux).

## One command (settings, DNS, secrets)

```powershell
cd "D:\All Apps\gumakart"
.\scripts\deploy-cloudflare.ps1                 # all three
.\scripts\deploy-cloudflare.ps1 -App admin      # one app
.\scripts\deploy-cloudflare.ps1 -SkipInstall    # quicker re-deploy
```

First time only: create `.env.cloudflare` in the repo root (gitignored) with the **production**
pooled database URL, so the dev URL in `.env` can never be deployed by accident:

```
DATABASE_URL_POOLED=postgresql://...@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

(Neon → Gumakart → production → **Connect**, connection pooling **on**.) The script shows the
database host and asks before going on. On the first run it also adds `CRON_SECRET`,
`STOREFRONT_PREVIEW_SECRET`, `SMS_OPT_OUT_SECRET` (random) and the launch defaults
`WALLET_PAYOUTS_ENABLED=false`, `BAYANGO_ENABLED=false`, `NEXT_PUBLIC_PLAN_BILLING_ENABLED=false`
to that file. Every other non-empty key in `.env` + `.env.cloudflare` is uploaded as a Worker
secret, except `CLOUDFLARE_*`, `NEXT_PUBLIC_*` and anything pointing at localhost.

Token (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in `.env`, or the Kuya Eddie `.env`):
Account → Workers Scripts:Edit, Workers R2 Storage:Edit; Zone guma.one → Workers Routes:Edit,
DNS:Edit, Zone:Read.

## Cutover from the Proxmox tunnel

admin.guma.one and ops.guma.one (and possibly kart.guma.one) are public hostnames on the
Cloudflare Tunnel to CT 106. A Worker custom domain can't share a name with a DNS record, so the
script finds the tunnel CNAME and offers to delete it. After a good deploy, also remove those
hostnames under Zero Trust → Networks → Tunnels → (tunnel) → Public hostnames, then the CT can be
stopped.

**Rollback:** Workers & Pages → the Worker → Settings → Domains → remove the custom domain, then
add the public hostname back on the tunnel (service `http://localhost:<port>`) — it recreates the CNAME.

Before switching, copy existing photos from the CT into R2 (next section) and check Google sign-in
still has `https://admin.guma.one/api/auth/google/callback` as a redirect URI (same host, so no change).

## Files

| File | Purpose |
|---|---|
| `apps/*/wrangler.jsonc` | Worker name, `nodejs_compat`, static assets, custom domain, bindings, public vars |
| `apps/*/open-next.config.ts` | OpenNext config (default cache) |
| `apps/admin/cron-worker.ts` | Admin entry: OpenNext worker + `scheduled()` cron dispatcher |
| `apps/web/lib/r2-uploads.ts`, `apps/admin/lib/r2-uploads.ts` | R2 read/write helpers |
| `scripts/deploy-cloudflare.ps1` | settings check → R2 bucket → build → deploy → secrets → smoke test |
| `scripts/deploy-kart.ps1` | old name, now just `deploy-cloudflare.ps1 -App web` |

## Things to know

- **Uploads (R2 `gumakart-uploads`).** Workers have no disk. Keys mirror the old paths:
  - `products/<tenantId>/<file>` — written by admin, served by the storefront at
    `/uploads/products/<tenantId>/<file>` and by admin at `/api/products/media`.
  - `payment-proofs/<slug>/<order>/<file>` — written and served by the storefront.
  - `kyc/<tenantId>/<file>` — private; stored as `r2:kyc/...` and only streamed by admin's
    `/api/kyc/document/<id>` (session or KYC token required).
  - Off Workers (local dev) the binding is absent and the old disk paths are used.
  - One-time copy of existing photos from CT 106 (run inside the CT; needs a wrangler login or token):
    ```bash
    cd /root/guma/apps/web/public/uploads
    for f in $(find products payment-proofs -type f); do npx wrangler r2 object put "gumakart-uploads/$f" --file="$f" --remote; done
    ```
    Old KYC files under `apps/admin/.data/kyc` keep their `local:` keys and won't load on Workers; the
    seller can re-upload, or copy them to `kyc/<tenantId>/<file>` and update `storage_key` to `r2:kyc/...`.
- **Crons.** The free plan allows 5 cron triggers per account (Kuya Eddie uses one), so admin has a
  single `* * * * *` trigger (Phase 16; was `*/5`) and `lib/cron-schedule.ts` picks the jobs (UTC): outbox and webhooks every minute,
  expire-orders hourly at :20, wallet-settlement hourly at :40, agent-reminders 09:00,
  agents daily 10:00, agents weekly Mon 02:00. Each job is an in-process request with
  `Authorization: Bearer CRON_SECRET`. Watch them with `pnpm exec wrangler tail` in `apps/admin`.
  `apps/admin/vercel.json` is no longer used.
- **Database.** `postgres` (postgres.js) over `nodejs_compat` TCP, Neon **pooled** URL. Workers can't
  reuse a socket across requests, so `getDb()` keeps one client per request on Workers
  (`packages/db/src/client.ts`); elsewhere it's the usual singleton.
- **Photo enhance** (admin → product photo → Enhance) uses the remove.bg API on Workers: set
  `REMOVE_BG_API_KEY` in `.env.cloudflare`. Without it the button says it isn't set up. The local
  ONNX model + sharp path still works in dev.
- **Images.** No `IMAGES` binding, so `next/image` serves originals (no resizing). Add a Cloudflare
  Images binding later if bandwidth matters.
- **Free-plan CPU limit (10 ms per request).** Most requests wait on the database rather than use
  CPU, but heavy server-rendered pages can hit it (error 1102 in `wrangler tail`). If that shows up,
  Workers Paid ($5/month) lifts it to 30 s; nothing else changes.
- **Fonts.** `next/font/google` downloads at build time, so the build machine needs internet.
- **Inngest.** `/api/inngest` lives on admin as before; point the Inngest app at
  `https://admin.guma.one/api/inngest` if/when Inngest is turned on.

## Verified (2026-10-03, local workerd via `wrangler dev`)

All three apps build with OpenNext (admin ≈ 2.2 MB gzipped). Admin: login/signup pages, signup
API, products page, product photo upload to R2 and read back, all five cron routes repeatedly
(after the per-request DB fix), `scheduled()` dispatch. Storefront: `/`, `/kart`, a shop page,
and the admin-uploaded photo served from the shared R2 bucket. Platform: login page and login API.
