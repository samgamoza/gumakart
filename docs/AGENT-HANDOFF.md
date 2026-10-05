# Guma Kart — Agent Handoff Document

**Last updated:** 2026-10-03 (Cloudflare Workers setup for all three apps; Phase 1 + Phase 2 of the V1 plan shipped to branch `wip/uncommitted-work-2026-08-01`; PayMongo on hold; work paused for another venture)  
**Purpose:** Hands-off context for the next agent or developer. Read this before making changes.

> **Strategy re-audit (external review):** [`GUMA-SOCIAL-CHECKOUT-STRATEGY-REVIEW.md`](./GUMA-SOCIAL-CHECKOUT-STRATEGY-REVIEW.md)  
> **Repo preservation / baseline investigation:** [`MISSION-000-EXECUTABLE-BASELINE.md`](./MISSION-000-EXECUTABLE-BASELINE.md)  
> **Chief Engineer review:** [`CHIEF-ENGINEER-REVIEW-SUMMARY.md`](./CHIEF-ENGINEER-REVIEW-SUMMARY.md)  
> **Execution prompt (binding for that pass):** [`CURSOR-CHIEF-ENGINEER-PROMPT-2026-08-06.md`](./CURSOR-CHIEF-ENGINEER-PROMPT-2026-08-06.md)  
> **Whole-repo truth:** Prefer [`COMPREHENSIVE-HANDOFF-2026-07-12.md`](./COMPREHENSIVE-HANDOFF-2026-07-12.md) for architecture, sprints, and roadmap.  
> **This file** keeps session narratives + durable pitfalls. Where they conflict, comprehensive handoff + ADR-0001 + chief summary win.

> Newest durable deltas (2026-08-20): **Mission 000 (repo hygiene)** — added `.gitattributes` (fixed a CRLF-drift bug that made ~99% of the tree falsely show as modified), untracked `*.tsbuildinfo` caches, committed the previously-uncommitted 2026-08-07→08 session notes below. **External strategy re-audit** delivered — flags the Checkout-First-vs-Template-Intel direction as unresolved (see Session 2026-08-20) and reconfirms the unfixed concurrent-checkout stock race at `packages/db/src/queries/orders.ts:250`. Prior: Platform ops control plane + Template Intel + PayMongo gate (2026-08-07→08); Chief Engineer Phases 1–6 + marketing legal UX (2026-08-06).

> **START HERE (2026-10-03):** the plan of record is [`GUMA-KART-V1-PLAN-REVISED.md`](./GUMA-KART-V1-PLAN-REVISED.md). Phase notes: [`PHASE-1-NOTES-2026-10-02.md`](./PHASE-1-NOTES-2026-10-02.md), [`PHASE-2-NOTES-2026-10-03.md`](./PHASE-2-NOTES-2026-10-03.md), [`PAYMONGO-TRACK-2026-10-03.md`](./PAYMONGO-TRACK-2026-10-03.md), spec [`PHASE-2-MIGRATION-SPEC.md`](./PHASE-2-MIGRATION-SPEC.md). Audits: [`CURRENT-STATE-AUDIT-2026-10-02.md`](./CURRENT-STATE-AUDIT-2026-10-02.md), [`VEYRON-BAYANGO-FIT-AUDIT-2026-10-02.md`](./VEYRON-BAYANGO-FIT-AUDIT-2026-10-02.md). The session section below supersedes older sections where they conflict (e.g. order statuses, KYC, payouts).

> **Deferred post-MVP beta:** Trust / Legal entity page (real SEC/TIN); KYC review queue + wallet/payout ops UI on Platform. **Do not start** Workstation / LangGraph / Meta Messenger without a new Chief Engineer directive (Phase 7).

---

## Session 2026-10-02 → 2026-10-03 — Rebrand, V1 plan, Phase 1, Phase 2 (PAUSED here)

**Status when paused:** all work committed and **pushed** to `origin/wip/uncommitted-work-2026-08-01` (head `60e9f4b`). Not merged to `main`, **not deployed**. **Neon production is migrated through 0022 and verified** (2026-10-03: V1–V5 all 0). Note the first `migrate` went to a different DB because `.env`'s `DATABASE_URL_UNPOOLED` wins over `DATABASE_URL` in `drizzle.config.ts`; for production set `$env:DATABASE_URL_UNPOOLED` in the shell. Work paused for another Guma venture.

### Commits (oldest → newest)
| Commit | What |
|---|---|
| `f8b6232` | Full rename Guma Commerce → **Guma Kart** (`@gumakart/*`, repo `samgamoza/gumakart`). |
| `48a09a5` | **BayanGo partner hook** (client/adapter, signed webhook `/api/webhooks/bayango`, migration 0018) + current-state and Veyron/BayanGo fit audits. Contract: `docs/BAYANGO-PARTNER-API-CONTRACT.md`. BayanGo side is being built by Cursor from `BayanGo App/docs/CURSOR-PROMPT-PARTNER-API.md`. |
| `d756a9a` | **Phase 1:** KYC lock-down (platform review only, payouts off behind `WALLET_PAYOUTS_ENABLED`), order access tokens (`?t=` links, migration 0019), single order lifecycle service, idempotent restock, refund NOWAIT lock, unpaid-order expiry cron. |
| `f52ffd0` | **Phase 1 close-out:** Grab webhook fail-closed, Lalamove signature fix, reserved slugs, real shops before demo shops, push-unsubscribe scoping, signed draft preview (`STOREFRONT_PREVIEW_SECRET`), `stock_movements` ledger (0020). |
| `832bf61` | **PayMongo** moved to hosted Checkout Sessions + return page (code ready, **on hold**); Phase 2 spec. |
| `946ac2e` | **Phase 2:** three order states (order/payment/fulfillment), migrations 0021+0022, pure state machine `packages/db/src/queries/order-state.ts`, order service `applyOrderAction` (dual-writes legacy `status`/`payment_status`), outbox relay `/api/cron/outbox`, `message_log` + `sendWithLog`, consent checkbox, locations, new admin order tabs, per-shop unpaid expiry, plan upgrades "coming soon". |
| `60e9f4b` | **Pre-deploy follow-ups:** SMS opt-out link (`/stop/<token>`, Semaphore can't receive STOP replies), Platform → SMS & opt-outs, Lalamove webhook variant verifier + `lalamove:check` sandbox script. |

Also committed in **veyron-pos-saas** (`999833a`, branch `feature/ci-locations-promotions`, not pushed by us): super_admin escalation fix, `/debug/routes` dev-only, API login rate limit, PayPal stub disabled, tenant-scoper INSERT bug fix + tests.

### Owner decisions in force
- Payments: **direct GCash/Maya/bank + COD** now. **PayMongo on hold** until Guma One business registration + BIR are funded; code is ready (`docs/PAYMONGO-TRACK-2026-10-03.md`). Paid plan upgrades hidden (`NEXT_PUBLIC_PLAN_BILLING_ENABLED=false`).
- BayanGo: separate product; Cursor builds its partner API; Guma side hook is done.
- Veyron: stays separate; **POS Lite built natively in Guma Kart** (plan Phase 5).
- Pricing: plan §18 recommendation (add-ons + plan inclusion), validate in beta.
- Hosting: Cloudflare Workers now, Proxmox later is possible (plan §19).
- Phase 2 decisions D1–D5: accept = timestamp; STOP blocks reminders not order updates; STOP is platform-wide; unpaid expiry per shop (1–72 h, default 24); drop legacy columns one release after a clean week.

### To finish the deploy (in order)
1. ~~Migrate Neon production + verify~~ — done 2026-10-03.
2. **All three apps → Cloudflare Workers** (decided 2026-10-03, see [`DEPLOY-CLOUDFLARE.md`](./DEPLOY-CLOUDFLARE.md)): create `.env.cloudflare` with the production **pooled** `DATABASE_URL_POOLED`, then `.\scripts\deploy-cloudflare.ps1`. It cuts admin/ops (and kart) over from the CT 106 tunnel, generates `CRON_SECRET` / `STOREFRONT_PREVIEW_SECRET` / `SMS_OPT_OUT_SECRET`, and sets `WALLET_PAYOUTS_ENABLED=false`, `NEXT_PUBLIC_PLAN_BILLING_ENABLED=false`, `BAYANGO_ENABLED=false`. Copy existing photos from the CT to R2 first (doc has the loop).
3. Env checks: `REMOVE_BG_API_KEY` if photo enhance should work on Workers.
4. Crons: handled by the admin Worker (`apps/admin/cron-worker.ts`, one `*/5` trigger): outbox every 5 min, expire-orders hourly, wallet-settlement hourly, agents as before. `apps/admin/vercel.json` is unused.
5. Smoke test: COD order; manual GCash order (proof → confirm / "Not received"); book + assign rider; deliver; cancel unpaid; buyer order page via SMS link; draft Preview from admin.
6. Lalamove: `pnpm --filter @gumakart/services lalamove:check -- https://<web>/api/webhooks/lalamove` with sandbox keys → set `LALAMOVE_WEBHOOK_VARIANT` from the log.
7. After a clean week of verify queries: move `drizzle-pending/0030_phase2_constrain.sql` into `drizzle/` (journal idx 30) and migrate. Later: a further migration drops legacy columns.

### Next work when resuming (plan §11)
- **Phase 3 — Checkout Links** (entity, merchant UI, production checkout from the `/kart` components, abandonment capture, source tracking).
- Phase 4 SMS recipes (consume outbox events via Inngest; every reminder must use `withOptOutFooter`, enforced by `sendWithLog`), Phase 5 POS Lite, Phase 6 nav/onboarding.
- Parallel: PayMongo go-live when registration is done.

### Auth hardening (2026-10-04)
- **Signup is now 3 steps:** account → 6-digit email code → shop. `POST /api/auth/signup/start` (validates, rejects taken emails, emails a code, creates nothing) → `POST /api/auth/signup/verify` (returns a 30-min signed signup ticket) → `POST /api/auth/signup` (requires the ticket; account is created already verified). Codes: HMAC-hashed in `email_verification_codes` (migration **0023_email_codes**), 10-min expiry, 5 tries, 60 s resend cooldown, single use. Code: `packages/auth/src/email-code.ts`.
- **Unverified older accounts** are sent to `/verify-email` by the admin middleware (API calls get 403 `EMAIL_UNVERIFIED`) until they enter a code (`POST /api/auth/verify-email/code`). Old `?token=` links still work.
- Password rule: 8+ chars with a letter and a number, common passwords rejected.
- **Needs:** run `migrate` against Neon production (0023), and a working sender: `RESEND_API_KEY` + `EMAIL_FROM` on a Resend-verified domain (e.g. `Guma Kart <no-reply@guma.one>`). Without them production refuses to send codes (no silent success); local dev shows the code on screen.
- The deferred Phase 2 constraint SQL (`drizzle-pending/0030_phase2_constrain.sql`) goes into the journal as **idx 30** (0024 checkout links, 0025 POS Lite, 0026 variants, 0027 staff, 0028 after-sale, 0029 Guma ID).
- Static files (`/brand/*`, images) now bypass the admin/ops auth middleware (the logo was being redirected to /login).

### Pitfalls learned this session
- **drizzle 0.38** renders `.for("update", { noWait: true })` as invalid `for update no wait` — use raw `FOR UPDATE NOWAIT` (see `refundOrder`).
- All order changes go through `applyOrderAction` / `refundOrder`. Never write `orders.status` directly — it's a dual-written legacy column.
- Integration tests need local Postgres (`DATABASE_URL=postgres://postgres:postgres@localhost:5434/gumakart`) and refuse Neon. Veyron's `.env` points at Neon — run its tests with `DATABASE_URL=""` (SQLite).
- Semaphore is send-only; STOP must be a link. A marketing SMS without `/stop/` link throws.
- `drizzle-pending/` holds SQL that must not auto-apply (not in the journal).
- **Cloudflare Workers:** never keep a DB socket in a global across requests (the next request hangs and gets cancelled) — `getDb()` is per-request on Workers. No disk: uploads go to R2 (`gumakart-uploads`). No `sharp`/`child_process` at runtime. Free plan = 5 cron triggers per account and 10 ms CPU per request (Workers Paid $5/mo if error 1102 shows up).
- Commits use the repo-local identity `mateenforjob-max`; `simply-sweet-source` submodule pointer and `docs/Guma_Kart_V1_Implementation_Plan.md` were intentionally left uncommitted.

---

## Mission 001 (2026-08-20) — Concurrent checkout stock safety + fresh-DB migration repair

**Two fixes, both verified by executed tests against a disposable Postgres container (never Neon).**

### 1. Oversell under concurrent checkout — FIXED
`createOrderForTenant` checked stock with an **unlocked read** (`orders.ts:209`) and then decremented **unconditionally** (`~380`, `greatest(stockQty - qty, 0)`). Two buyers of the last unit both passed the check, both decremented, and `greatest(…, 0)` floored the result at zero — so the oversell produced **no error anywhere**; you'd discover it when packing the order.

Fix: the decrement is now atomic and conditional — `UPDATE … SET stock_qty = stock_qty - qty WHERE id = ? AND stock_qty >= qty RETURNING stock_qty`. Postgres row-locks the variant, so a racing checkout blocks, then re-evaluates against the committed value. Zero rows returned ⇒ throw `OUT_OF_STOCK` ⇒ the whole transaction rolls back (order, items, status history, customer upsert, claimed order number). **Do not reintroduce `greatest(…, 0)` here** — it hides oversells rather than preventing them.

Test: `packages/db/src/orders-concurrency.test.ts` — two simultaneous `createOrderForTenant` calls against `stockQty = 1`; asserts exactly one succeeds, stock lands at exactly 0, and the loser leaves no orphan order row. Real DB, no mocks; hard-refuses to run against a hosted/Neon URL.

**Not fixed (deliberate):** the coupon redemption cap (`orders.ts:243–250`) remains a soft limit. Already acknowledged in code, bounded impact (a discount over-granted vs. an item sold that doesn't exist). Separate decision.

### 2. `_journal.json` was missing `0002` — fresh databases could not be built AT ALL
`0002_nosy_ikaris.sql` existed on disk but had no journal entry, so drizzle-kit silently skipped it. Existing databases were fine (0002 ran before the entry went missing), so this stayed invisible — until a clean Postgres container was migrated on 2026-08-20 and died at `0007` with `relation "platform_audit_log" does not exist` (a table 0002 creates). **Any new dev machine, staging environment, or disaster-recovery restore was broken.**

Fixed by restoring the entry with 0002's original timestamp `1783249404693`, recovered from production's own `__drizzle_migrations` row so the journal and the live ledger stay in sync. Safe for production: drizzle only applies migrations newer than the newest applied one, so 0002 is skipped there — and its objects already exist.

Regression guards added to `packages/db/src/migration-journal.test.ts`: every `.sql` file must have a journal entry, indices must be contiguous, timestamps must strictly increase. The previous version of that test only asserted a handful of specific tags were present, which is why a missing entry went unnoticed.

### Verify locally
```powershell
docker run -d --name guma-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=gumakart -p 5435:5432 postgres:16-alpine
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5435/gumakart"
pnpm --filter @gumakart/db exec drizzle-kit migrate      # must apply all 18 cleanly
pnpm --filter @gumakart/db exec tsx --test src/migration-journal.test.ts
pnpm --filter @gumakart/db exec tsx --test src/orders-concurrency.test.ts
docker rm -f guma-test-pg
```
Note: the repo's `docker-compose.yml` binds host port **5434**, which was already occupied on this machine — hence the ad-hoc container on 5435 above.

---

## Session 2026-08-20 — Full re-audit (correct repo) + Mission 000 executable baseline

**Branch:** `wip/uncommitted-work-2026-08-01` (3 new local commits, **not yet pushed** — see below)  
**Context:** An external review agent had audited the wrong clone (`C:\Users\samga\gumacommerce`, a stale fork of this repo missing CI/governance/event-bus/delivery-orchestrator/tests) and had to be corrected mid-session. This session is the redo against this actual repo, reframed as a compliance/gap check against our own Constitution, ADR-0001, Article VI, and `CHECKOUT-FIRST-OVERHAUL-PLAN.md` — not a green-field proposal, since most of what a naive review would "recommend" already exists here.

### What landed

1. **`GUMA-SOCIAL-CHECKOUT-STRATEGY-REVIEW.md`** — full re-audit. Headline finding: **the Checkout-First-vs-Template-Intel direction is still unresolved.** `CHECKOUT-FIRST-OVERHAUL-PLAN.md` Phase 0 and Phase 2 (delivery orchestrator) shipped; Phase 1 (neutral checkout-first default) and Phase 3 (re-scoped onboarding) did not — `apps/web/components/storefront/tenant-storefront-home.tsx` still dispatches to 20 named vertical renderers (lines 89–169) with `ThemedStorefrontHome` as the fallback (line 173), not a neutral checkout surface. No doc says whether that's still the plan or whether Template Intel superseded it. Also reconfirms the unfixed concurrency bug at `packages/db/src/queries/orders.ts:250` (unlocked stock read, self-acknowledged in-code: `// row locked FOR UPDATE (deferred — see review remediation).`), and clarifies that `checkout_sessions` (`0009_checkout_domain.sql`) is **abandonment-telemetry only** — its own route comment says so — not an inventory-reservation mechanism, so it does not cover the concurrency gap.
2. **Mission 000 (Repository Preservation and Executable Baseline)** — see `MISSION-000-EXECUTABLE-BASELINE.md` for full detail:
   - Root-caused the "571 modified files" alarm: no `.gitattributes` existed, so Windows CRLF saves made ~99% of the tree show as modified with zero real content change (`git diff --shortstat -w` → 5 files, not 572).
   - Added `.gitattributes` (`* text=auto eol=lf`) and `*.tsbuildinfo` to `.gitignore`; untracked the 3 already-tracked build-info caches.
   - Secret scan: clean — only `.env.example` (template) is tracked anywhere.
   - Toolchain could **not** be run from the reviewing sandbox (npm registry blocked by proxy allowlist, corepack `EACCES` on symlink) — still needs a real `pnpm install && pnpm build/lint/test` pass on an actual dev machine before treating the baseline as green.
   - Migration journal gap at `idx=2` reconfirmed (`0002_nosy_ikaris.sql` missing from `_journal.json`); its SQL is fully idempotent (`IF NOT EXISTS` / `duplicate_object` guards throughout), which lowers the risk of reconciling it.
   - Fail-closed integration posture and the Lalamove optional/flat-rate-fallback design were traced directly in `packages/services/src/config/{integrations,runtime-mode}.ts` and confirmed to match what the docs claim.
   - `simply-sweet-source` is an orphaned gitlink (mode `160000`, no `.gitmodules`) — **still needs a founder decision** (real submodule vs. subtree vs. untrack), not resolved this session.

### Key commits (this session, local only — not yet pushed)
| Commit | Summary |
|--------|---------|
| `eeba3ab` | `.gitattributes` + `.gitignore` tsbuildinfo ignore (Mission 000 Slice A) |
| `ec16fe3` | Commits the 2026-08-07→08 session notes below (was sitting uncommitted) |
| `8a4b6a3` | Adds `GUMA-SOCIAL-CHECKOUT-STRATEGY-REVIEW.md` + `MISSION-000-EXECUTABLE-BASELINE.md` |

### Pitfalls
- **⚠️ `pnpm db:migrate` CANNOT backfill a skipped migration — and it will lie to you about it.** drizzle-kit's migrator does not compare hashes to decide what to run: it takes the newest applied migration's `created_at` and applies only journal entries **newer** than that. So if any migration is missed or its objects are lost, every later `db:migrate` prints `migrations applied successfully!` while silently skipping it, forever. Deleting its row from `drizzle.__drizzle_migrations` does **not** help (tested this session — the row was deleted, migrate still skipped it, because 0013's `1784472036087` is older than 0017's `1784800000000`). The only fix is to apply that migration's SQL directly, then re-insert its ledger row.
- **This bit us for real on 2026-08-20:** `0013_support_helpdesk` was recorded in the ledger but none of its objects existed (no `support_tickets` / `support_ticket_messages`, none of its 4 enums) — most likely dropped manually at some point without touching the ledger. Symptom: Platform dashboard 500s with `PostgresError: relation "support_tickets" does not exist` (the attention strip queries it on load). Fixed by running 0013's SQL by hand in the Neon SQL Editor + re-inserting the ledger row (`hash a799de63…`, `created_at 1784472036087`). **The `idx=2` gap in `_journal.json` (`0002_nosy_ikaris.sql` exists on disk, absent from the journal) is the same class of problem and is still latent** — worth verifying `0002`'s objects actually exist before it surfaces the same way.
- **Where production actually lives:** Neon org **"Michael"** → project **"SariLink"** → branch `production` → db `neondb`, region **Singapore (`ap-southeast-1`)**. This is documented nowhere else and cost real time to find — there are at least two decoy Neon projects on adjacent accounts (an empty Ohio one, and a `neon-sky-car` under a Vercel-linked org holding an unrelated blog/photo app). Verify by region + table list before running anything destructive.
- This Windows-mounted checkout leaves `.git/index.lock` / `.git/HEAD.lock` behind after **every** git write that a sandboxed/remote agent can't self-clean (`Operation not permitted` on unlink) — needed manual deletion from the Windows side after each commit in this session. If another remote agent works this repo, expect the same and budget for it.
- Pushing to `origin` from a network-sandboxed review agent is blocked (`403` from the proxy on `github.com`) — the 3 commits above are local-only until someone runs `git push origin wip/uncommitted-work-2026-08-01` from an actual machine with GitHub access.

### Open / next
| Priority | Item |
|----------|------|
| Housekeeping | Push the 3 pending local commits to `origin` |
| Housekeeping | Decide `simply-sweet-source`: real submodule / subtree / untrack, then execute |
| ~~Correctness~~ | ~~Verify `0002_nosy_ikaris.sql`~~ **DONE 2026-08-20** — the journal entry was missing, which meant **no fresh database could be built at all**; restored + regression-guarded. See Mission 001 section |
| Housekeeping | `.neon` file appeared from the Neon CLI wizard — check it for credentials and `.gitignore` it if so |
| ~~Correctness~~ | ~~**Mission 001** — concurrent-checkout stock race~~ **DONE 2026-08-20** — see Mission 001 section below |
| Correctness | Coupon redemption cap is still a soft limit (`orders.ts:243–250`, acknowledged in code) — separate, lower-severity decision, deliberately left alone during Mission 001 |
| Strategic | Resolve Checkout-First vs. Template-Intel: is the neutral checkout surface still the intended default `/{slug}` experience, or has Template Intel superseded that plan? Gates a lot of future storefront work either way |
| Verification | Run a real `pnpm install && pnpm build/lint/test` pass on an actual dev machine — could not be executed from the review sandbox |
| Verification | Read-only check of `drizzle.__drizzle_migrations` on the live DB for whether the `0002` hash is recorded |

### Recommended next prompt
> Read `docs/AGENT-HANDOFF.md` (Session 2026-08-20) and `docs/GUMA-SOCIAL-CHECKOUT-STRATEGY-REVIEW.md`. Push the 3 pending local commits first. Then either (a) resolve the `simply-sweet-source` housekeeping decision, or (b) start Mission 001 (concurrent-checkout stock race: unlocked read `orders.ts:209` + unconditional decrement ~380) — confirm which with the founder before touching `orders.ts`. Constraints unchanged: never `db:push`; never `@gumakart/db` from `"use client"`; fail-closed integrations; ADR-0001.

---

## Session 2026-08-07 → 2026-08-08 — Platform ops + Template Intel + PayMongo gate

**Branch:** `wip/uncommitted-work-2026-08-01` (pushed through `5989648`)  
**Public soft-launch:** storefront `https://commerce.guma.one`, admin `https://admin.guma.one`, ops `https://ops.guma.one`  
**Deploy:** `.\deploy.ps1` packages working tree → CT 106 (keeps CT `.env`; excludes runtime uploads). SSH to PVE may flake (`Permission denied`) — retry when host is up.

### What landed

1. **Marketplace checkout UX** (`apps/web/components/checkout-form.tsx`) — Shopee/Lazada-style layout: desktop 2-col + sticky summary; mobile sticky total; marketplace orange accent.
2. **Template Intel (ops)** — `apps/platform` `/templates`  
   - Coverage = Free Bundle seller-ready + **published** ops stock (drafts do not raise Coverage / Launch until Publish).  
   - Categories: parent/sub (`parentId`, migration `0017_shop_category_parent.sql`); Seed / AI on gap rows.  
   - Stock: Preview → `{STOREFRONT}/preview/stock/{stockKey}`; Publish/Archive.  
   - High-contrast sequential skins (`packages/storefront-themes/src/stock-skin.ts`) so Look variants are visually distinct.  
   - **AI skins** (`packages/ai/src/template-skins.ts`): thrifty model (Gemini Flash) → JSON look packs only; `source: ai_curated`; fallback skins if no key.  
   - **Seller-facing labels:** no more “Haircut Look 1” — palette names (e.g. Manila Sunset Soft). Opening Template Intel renames leftover Look-N rows; Launch uses `sellerFacingStockLabel`.
3. **Platform Settings** — `/settings` (grouped sidebar: Overview / Shops / Commerce / Trust / Growth / System)  
   - Soft-launch / free template switch / upgrade gate: Force on|off|inherit (`platform_settings` overrides env).  
   - Global payments mode default; helpdesk notify + support contact emails; AI/provider key status (configured/missing only); integrations health.  
   - Secrets stay in `.env` — never shown.
4. **Support access (impersonate)** — Platform Tenants → **Open as Support**  
   - Short-lived grant JWT → `admin.*/api/auth/support-access` sets host-scoped session (`supportAccess: true` + target `tenantId`).  
   - Ops cookie on `ops.*` stays separate. Amber banner + Exit to Platform. Audited (`support_access_started`).  
   - `requireTenantSession` honors JWT shop context for super_admin support sessions (DB `users.tenant_id` stays null).
5. **Attention strip** on Platform Dashboard — open/SLA tickets, pending/suspended shops, moderation backlog, stock drafts.
6. **PayMongo activation = Platform-only**  
   - Sellers: Settings → Payments = receiving accounts + **read-only** mode status. API **403** if they PATCH `payments.mode`.  
   - Platform: Settings = global default; Tenants → shop → **Checkout payments mode** per-tenant override (`setTenantPaymentsMode`).  
   - Checkout resolves: tenant override → platform setting → `PAYMENTS_MODE` env.
7. **Ownership rule (documented in UI):** Platform oversees/intervenes; seller admin runs one shop. KYC review + payout queues still missing on Platform (seller/auto today).

### Key commits (this arc)
| Commit | Summary |
|--------|---------|
| `fc4bbfa` | Marketplace checkout, Template Intel ops, distinct stock skins |
| `e944304` | High-contrast sequential Looks + specialty visibility |
| `5c02d01` | Landing demo CTAs `/demo` → `/model` |
| `ac1a2bb` | Ops Settings, Support access, AI skins, PayMongo gate |
| `5989648` | Replace Look N stock labels with palette names |

### Env notes (ops / soft-launch)
```
# Soft launch (also Forceable from Platform → Settings)
GUMA_SOFT_LAUNCH=true
# GUMA_FREE_TEMPLATE_SWITCH=true
# GUMA_TEMPLATE_SWITCH_REQUIRES_UPGRADE=true

PAYMENTS_MODE=manual_ewallet
GEMINI_API_KEY=          # Template Intel AI skins (optional; fallback works)
HELPDESK_NOTIFY_EMAIL=   # overridable from Platform Settings
NEXT_PUBLIC_STOREFRONT_URL=https://commerce.guma.one
NEXT_PUBLIC_ADMIN_URL=https://admin.guma.one
NEXT_PUBLIC_PLATFORM_URL=https://ops.guma.one
```

### Pitfalls
- Platform and admin cookies are **host-scoped** (no shared Domain) — Support access **must** exchange on `admin.*`, not set cookie from ops.
- Coverage ignores drafts until Publish; Seed/AI always create drafts.
- Stock keys `…-v01` still drive the contrast ladder; only the **label** is seller-facing.
- Never let sellers self-activate PayMongo mode again.
- Soft-launch template switch reads Platform ops overrides in Launch API (`SoftLaunchOverrides`).

### Open / next
| Priority | Item |
|----------|------|
| Ops | Re-run `.\deploy.ps1` if CT was behind (Look-N rename + latest Settings) |
| Ops | Set `GEMINI_API_KEY` on CT for live AI skins |
| Platform | KYC review queue + wallet/payout approval UI |
| Platform | Orders detail + ops intervene (still mostly read-only) |
| Housekeeping | `*.tsbuildinfo` / dirty `simply-sweet-source` — still uncommitted by design |

### Recommended next prompt
> Read `docs/AGENT-HANDOFF.md` (Session 2026-08-07→08). Platform has Settings, Support access, Template Intel AI skins, PayMongo Platform-only. Soft-launch on CT 106. Next: KYC/payout ops queues or order intervention — not Workstation. Constraints: never `db:push`; never `@gumakart/db` from `"use client"`; fail-closed integrations; ADR-0001.

---

## Session 2026-08-06 — Chief Engineer directive (Phases 1–6) + marketing legal UX

**Branch:** `wip/uncommitted-work-2026-08-01` (pushed to `origin`)  
**Binding:** ADR-0001 wins on conflict; fail-closed integrations; no Prisma/RLS/new draft tables; no killaislop SaaS.

### What landed (by phase)

1. **Phase 1 — Commit hygiene** — Prior ~130-file working tree sliced into reviewable commits (`3ac9706`…`fe645bf`): db/schema → infra/fail-closed → delivery+helpdesk → chat+manual-pay → frontend1 polish → docs.  
   - Still uncommitted locally (intentionally): `apps/*/tsconfig.tsbuildinfo`, dirty `simply-sweet-source` submodule — **ask before deciding** (gitignore vs keep).
2. **Phase 2 — Suspend enforcement** (`672783d`) — Shared `packages/db/src/tenant-access.ts`.  
   - Admin writes hard-blocked (`requireTenantSession`); dashboard shows suspended notice; `/api/shop` GET allows suspended so UI can load.  
   - Storefront shows “Shop unavailable” (not Coming soon); checkout returns **403** `TENANT_SUSPENDED`.  
   - User-level suspend blocks seller login; tenant-level suspend allows login to see the notice.  
   - **Decision:** buyer payment-proof / order tracking for open orders stays allowed.
3. **Phase 3 — Brand Guard Slice A+B** (`457a0af`) — `pnpm brand-guard:scan` + `.github/workflows/brand-guard.yml`; validators in `packages/storefront-themes/src/brand-guard.ts` wired to Launch personalize + soft hints. Slice C (Workspace polish) **not** started.
4. **Phase 4 — Helpdesk email** (`dd29aa5`) — Resend via `packages/services/src/notifications/email.ts`.  
   - New ticket → `HELPDESK_NOTIFY_EMAIL`; agent reply → requester email. Fail-closed (`sent: false`, never fake success in prod). Health id: `email`.
5. **Phase 5 — Honest marketing** (`3f2b177`) — frontend1 FAQ/comparison/footer; frontend2 Hero/HowItWorks/Pricing/etc. stripped of auto-dispatch / fake stats overclaims. `getActiveLanding()` still defaults to **frontend1**.
6. **Phase 6 — Observability / tests** (`9884ae9`) — PayMongo + Grab HMAC unit tests; Sentry in integration health; checkout errors → `createLogger`; Inngest consumers ticketed `INNGEST-001…004` (still acknowledge-only); migration journal test for `0013`.
7. **Marketing footer + legal pages** (`b220639`) — Footer CTA/hierarchy; `LegalDocLayout` TOC; About/Privacy/Terms/Refunds/Contact refreshed for soft-launch honesty.  
   - **Deferred:** Trust / Legal entity page until real SEC/TIN (post MVP beta).

### Env notes (new / important)
```
RESEND_API_KEY=
EMAIL_FROM=
HELPDESK_NOTIFY_EMAIL=
NEXT_PUBLIC_PLATFORM_URL=http://localhost:3002
SENTRY_DSN=   # set on web + admin + platform Vercel projects
PAYMENTS_MODE=manual_ewallet
```

### Commands that should be green
```powershell
pnpm --filter @gumakart/db exec tsc --noEmit
pnpm --filter @gumakart/web exec tsc --noEmit
pnpm --filter @gumakart/admin exec tsc --noEmit
pnpm --filter @gumakart/platform exec tsc --noEmit
pnpm --filter @gumakart/db test
pnpm --filter @gumakart/services test
pnpm --filter @gumakart/storefront-themes test
pnpm brand-guard:scan
```

### Open / next (after this pass)
| Priority | Item |
|----------|------|
| Ops | Prod env checklist (`DEPLOY-VERCEL.md`): AUTH_SECRET, DATABASE_URL*, URLs, demo flag, payment/delivery/email/Sentry keys |
| Ops | Keep platform `active_landing` = **frontend1** for soft launch |
| Content | Real SEC / TIN / phone when available → then Trust / Legal entity page |
| Housekeeping | Decide `*.tsbuildinfo` gitignore; clean `simply-sweet-source` dirty submodule |
| Eng (later) | Brand Guard Slice C; fill Inngest stubs `INNGEST-001…004`; broader E2E |
| **Do not** | Workstation convergence / Meta Messenger / 100-template push without new directive |

### Recommended next prompt
> Read `docs/AGENT-HANDOFF.md` (this file) + `docs/CHIEF-ENGINEER-REVIEW-SUMMARY.md`. Branch `wip/uncommitted-work-2026-08-01` is pushed through Phases 1–6 + marketing legal UX. Next: prod cutover checklist / PR review — not Workstation. Constraints: never `db:push`; never `@gumakart/db` from `"use client"`; fail-closed integrations; ADR-0001.

---

## Session 2026-08-05 → 2026-08-06 — MVP ops: chat, delivery, helpdesk, Frontend1

### What landed
1. **Chat MVP Beta (owner-led)** — storefront Message seller + AI FAQ; seller `/messages`; WhatsApp overflow; no Messenger/websockets.
2. **Manual e-wallet** — buyer proof/reference; seller confirm-payment; `PAYMENTS_MODE`.
3. **Delivery** — quote/checkout/book via orchestrator (Lalamove ↔ Grab failover → manual); Grab webhook; **Assign rider** for Angkas/Move It/own rider.
4. **Helpdesk** — `support_tickets` + migration `0013`; web `/contact` creates tickets; admin Help & support; platform `/helpdesk` with SLA (4h / 48h).
5. **Frontend1 polish** — working mobile nav; same-origin `/model`; contact→ticket; storefront default port **3010**; hero CTAs → demo + signup.
6. **Seller UI calm-down** + products manual-first (AI enhance / suggest price only).

### Ports (local)
| App | Port |
|-----|------|
| web | **3010** (not 3000) |
| admin | 3001 |
| platform | 3002 |

### Quick verify
```powershell
pnpm db:migrate
pnpm --filter @gumakart/web run dev
pnpm --filter @gumakart/admin run dev
pnpm --filter @gumakart/platform run dev
# :3010/frontend1 · :3010/contact · :3001/messages · :3002/helpdesk
```

### Constraints (unchanged)
- Never `db:push`; never `@gumakart/db` from `"use client"`
- Never hardcode plan prices outside `@gumakart/plans`
- Production mocks refused — see `MVP-HARDENING-P1-INTEGRATION-MOCKS.md`

### Status note
Superseded for “what’s current” by **Session 2026-08-07 → 2026-08-08** (Platform Settings, Support access, Template Intel, PayMongo gate). Keep this section for MVP chat/delivery/helpdesk context.

---

## Session 2026-07-05 — Brand redesign + Platform (super-admin) console

### 1. Project overview (delta)
Three Next.js 15 (App Router, React 19) apps now exist in the `pnpm`+Turbo monorepo, all sharing `packages/*`:

| App | Path | Port | Role |
|-----|------|------|------|
| Storefront + marketing | `apps/web` | **3010** | `/{tenantSlug}` shops, checkout, buyer chat |
| Seller admin | `apps/admin` | 3001 | Per-tenant dashboard (one shop) |
| **Platform console (NEW)** | `apps/platform` | 3002 | **Super-admin over ALL tenants** |

Stack unchanged: TypeScript, Tailwind v3, Drizzle ORM → **Neon Postgres** (live, Singapore), JWT cookie auth (`jose`, cookie `gumakart_session`) in `packages/auth`, `bcryptjs` passwords. AI providers + PayMongo/Lalamove/Semaphore unchanged. Deployment target: Vercel (one project per app).

### 2. What was built this session
1. **Guma brand system ported into `apps/admin`** — the emerald/amber HSL design tokens, Bricolage Grotesque + Plus Jakarta Sans fonts, `hero-glow`/grid utilities, and animations from `apps/web` (landing redesign, commit `5facdd1`). Admin sidebar/header/dashboard redesigned with lucide icons (replacing violet theme + emoji nav).
2. **Seller storefront polish** — fixed off-brand violet in owner menu, accent-tinted checkout button, rebranded the "shop being set up" pending page, friendlier empty catalog state.
3. **`apps/platform` — a brand-new super-admin console** (the bulk of the session). Distinct dark-emerald sidebar to differentiate from the seller admin. Surfaces: Dashboard (MRR/GMV/shops/users KPIs + SVG revenue/signup charts + plan/status bars), Tenants (filterable list → detail with suspend/activate/set-pending/change-plan/view-storefront), Subscriptions (plan catalog + MRR/ARR/ARPU + per-shop plan mgmt), Users (role change + suspend/reactivate), Moderation (`content_queue` approve/reject/flag), Orders (platform-wide), Audit Log.
4. **DB schema additions** (see §4) + seeded a `super_admin`.

### 3. Files created / modified

**New — `apps/platform/` (entire app):**
- Config: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `next-env.d.ts`, `middleware.ts`
- `app/`: `globals.css`, `layout.tsx`, `page.tsx` (dashboard), `login/page.tsx`, `actions.ts` (server actions for all mutations), `tenants/page.tsx`, `tenants/[id]/page.tsx`, `subscriptions/page.tsx`, `users/page.tsx`, `moderation/page.tsx`, `orders/page.tsx`, `audit/page.tsx`, `api/auth/{login,logout,session}/route.ts`
- `components/`: `platform-shell.tsx`, `ui.tsx` (StatCard/StatusPill/PlanBadge/AreaChart/BarMeter/EmptyState/Panel), `login-form.tsx`, `filter-bar.tsx` (URL-synced), `tenant-actions.tsx`, `user-actions.tsx`, `plan-select.tsx`, `moderation-actions.tsx`
- `lib/`: `session.ts` (`requireSuperAdmin`), `api-auth.ts` (`requireSuperAdminApi`), `format.ts`, `plans.ts` (**client-safe** plan catalog — see pitfall in §6)

**New — db package:** `packages/db/src/queries/platform.ts` (all platform reads/writes + `PLATFORM_PLANS` catalog).

**Modified:**
- `packages/db/src/schema/index.ts` — added `users.status`, `content_queue` moderation cols, `platform_audit_log` table.
- `packages/db/src/index.ts` — re-export platform queries/types.
- `apps/admin/app/{globals.css,layout.tsx}`, `apps/admin/tailwind.config.ts`, `apps/admin/components/{admin-shell,dashboard-view}.tsx` — brand redesign.
- `apps/web/app/[tenantSlug]/page.tsx`, `apps/web/components/storefront/{shop-shell,shopify-catalog}.tsx` — storefront polish.

> ⚠️ The working tree also has **unrelated uncommitted changes from a prior session** (orders manager, cart, checkout/paymongo, `packages/db/src/queries/orders.ts`, etc.). Those were **not** touched this session — don't attribute or bundle them blindly.

### 4. Database changes (APPLIED to live Neon)
Applied via a **surgical idempotent SQL script** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`) — **NOT** `drizzle-kit push`, which failed trying to drop/rebuild a pre-existing primary key (`column "id" is in a primary key`). **Do not run `db:push` against this DB** — use targeted SQL or a proper generated migration.

Added:
- `users.status varchar(20) NOT NULL DEFAULT 'active'` — values `active | suspended`.
- `content_queue`: `flagged bool NOT NULL DEFAULT false`, `moderation_note text`, `moderated_by uuid → users`, `moderated_at timestamptz`, + `content_queue_flagged_idx`.
- New table `platform_audit_log` (id, actor_id, actor_email, action, entity_type, entity_id, entity_label, metadata_json, created_at) + 3 indexes.

**Schema drift note:** these are in `schema/index.ts` but **no drizzle migration file was generated** — the DB and schema agree, but `packages/db/drizzle/` is behind. Next agent should `pnpm db:generate` and reconcile before the next real migration.

### 5. Auth for the platform console
- Login: **`admin@guma.ph` / `GumaAdmin2026!`** (seeded super_admin; change before any shared/prod use).
- Only `role === 'super_admin'` may enter — enforced in `apps/platform/middleware.ts` AND `app/api/auth/login/route.ts`. Reuses the shared `gumakart_session` cookie + `packages/auth` token helpers (no changes to `packages/auth`).
- All mutations run through **server actions** in `app/actions.ts`, each guarded by `requireSuperAdminApi()` and writing a `platform_audit_log` row + `revalidatePath`.

### 6. Critical pitfalls / decisions
- **Client components must NOT import from `@gumakart/db`.** The package barrel pulls `client.ts` → `postgres` → node `net`, which breaks the browser bundle (`Can't resolve 'net'`) and 500s *every* page. Client-safe plan list: `apps/platform/lib/plans.ts` re-exports `@gumakart/plans` (`CLIENT_PLANS`). Server components/actions may still import from `@gumakart/db`.
- **~~Plan catalog inconsistency~~ → resolved (Sprint 4 / ADR D4).** Single source: `@gumakart/plans` (₱0 / ₱499 / ₱999; labels Free / Pro / Advance). Thin re-exports remain on db/ai for compat. Legacy `starter` rows normalize to `growth`.
- Charts are dependency-free inline SVG (`AreaChart`, `BarMeter` in `components/ui.tsx`) — no chart lib added.
- Pages are **server components** (direct query calls, no client fetch/loading states) + server actions for writes — the modern idiom, differs from `apps/admin`'s client-fetch+API-route pattern.

### 7. Verification done
- `tsc --noEmit` clean: `apps/platform` and `packages/db`.
- Platform dev server (port 3002) compiles; all 7 routes return 200 with live data (MRR ₱2,999 from 1 Pro shop; 4 shops; 4 users).
- End-to-end mutation tested: activated a pending tenant → status flipped + success toast + audit-log row with actor/label. **Test change was reverted** (tenant back to `pending`, test audit row deleted) — live data is clean.
- Not yet run: `next build` (production) for `apps/platform`; no automated tests exist.

### 8. Pending / recommended next steps (this session's scope)
- **High:** `pnpm db:generate` to create the migration file for the schema additions (DB is ahead of `drizzle/`).
- ~~**High:** Reconcile the 3 plan-price sources~~ — **done** (`@gumakart/plans`).
- **Medium:** `next build` the platform app; add it to CI/Vercel (new project, port 3002, same monorepo build command, needs `AUTH_SECRET` + `DATABASE_URL*`).
- ~~**Medium:** Enforce suspended user/tenant on seller + storefront~~ — **done** (2026-08-06 Phase 2; see top session).
- **Low:** Moderation currently only covers `content_queue`; extend to products if needed. Add pagination to platform tables (currently limit 200–500).
- **Housekeeping:** Prefer `COMPREHENSIVE-HANDOFF` + sprint docs for post-2026-07-05 work; current open items live in the **2026-08-06 Chief Engineer** session section above.

### 9. Next-agent quick start (platform work)
```cmd
cd C:\Users\samga\gumacommerce
pnpm install
pnpm --dir apps/platform exec next dev   # → http://localhost:3002, login admin@guma.ph / GumaAdmin2026!
pnpm --dir apps/platform exec tsc --noEmit
```
Inspect first: `apps/platform/app/actions.ts`, `packages/db/src/queries/platform.ts`, `apps/platform/components/platform-shell.tsx`, `apps/platform/lib/plans.ts`. **Warning:** never import `@gumakart/db` from a `"use client"` file; never run `db:push`.

### 10. Recommended next prompt (paste to continue)
> You're working in the `gumakart` pnpm+Turbo monorepo at `D:\All Apps\gumakart`. Read `docs/AGENT-HANDOFF.md` (top session 2026-08-06) + `docs/CHIEF-ENGINEER-REVIEW-SUMMARY.md`. Branch `wip/uncommitted-work-2026-08-01` is pushed through Chief Engineer Phases 1–6 + marketing legal UX. Apps: `web` (:3010), `admin` (:3001), `platform` (:3002). **Open:** prod cutover / secrets / demo flag; real SEC/TIN then Trust page; tsbuildinfo/submodule housekeeping; Brand Guard Slice C + Inngest fill-out later. **Do not** start Workstation without a new directive. Constraints: never import `@gumakart/db` from `"use client"`; never `db:push`; never hardcode plan prices outside `@gumakart/plans`; fail-closed integrations.

---

## 1. Product summary

**Guma Kart** is an AI-powered social commerce platform for Philippine sellers.

| Surface | Path | Port | Role |
|---------|------|------|------|
| Storefront | `apps/web` | **3010** | Marketing + `/{tenantSlug}` shops, checkout, buyer chat, webhooks |
| Admin | `apps/admin` | 3001 | Seller dashboard, messages, orders, Launch/Workspace, settings |
| Platform | `apps/platform` | 3002 | Super-admin ops: tenants, Settings, Template Intel, helpdesk, Support access, PayMongo mode, moderation |

**Core value:** Turn social traffic into a branded mobile storefront with GCash/Maya/COD, delivery stubs, AI content, and agentic daily posting workflows.

**Buyer chatbot** = pre-checkout assistant on storefront (`POST /api/chat`).  
**WhatsApp Agent** (Settings) = seller business number config — not the same as buyer chat.

---

## 2. Repository state (as of handoff)

| Item | Status |
|------|--------|
| **Local folder** | `D:\All Apps\gumakart` (active repo) |
| **Git** | Branch `wip/uncommitted-work-2026-08-01` pushed through `5989648` (see Session 2026-08-07→08). Prefer that section over older commit refs below. |
| **npm scope** | `@gumakart/*` |
| **Root package name** | `gumakart` |
| **Soft-launch deploy** | Proxmox CT 106 via `.\deploy.ps1` + Cloudflare (`commerce` / `admin` / `ops`.guma.one). Vercel path still documented in `DEPLOY-VERCEL.md`. |
| **DB** | Neon + migrations through Template Intel / soft-launch era (incl. `0017` category parent). Never `db:push`. |
| **Intentionally uncommitted** | `apps/*/tsconfig.tsbuildinfo`, dirty `simply-sweet-source` — ask before deciding |

---

## 3. Monorepo layout

```
gumakart/                    
├── apps/
│   ├── web/                     @gumakart/web
│   └── admin/                   @gumakart/admin
├── packages/
│   ├── ai/                      @gumakart/ai      — prompts, generator, plan limits, LLM router
│   ├── auth/                    @gumakart/auth     — sessions, Google OAuth, signup
│   ├── db/                      @gumakart/db       — Drizzle schema, migrations, queries
│   ├── services/                @gumakart/services — PayMongo, Lalamove, Semaphore SMS
│   ├── storefront-themes/       @gumakart/storefront-themes
│   ├── ui/                      @gumakart/ui       — shared Button, Card, Badge, etc.
│   └── media/                   @gumakart/media    — (minimal / stub)
├── docs/
│   ├── AGENT-HANDOFF.md         ← this file
│   ├── DATABASE.md
│   └── DEPLOY-VERCEL.md
├── docker-compose.yml           — local Postgres on port 5434, DB name `gumakart`
├── .env.example
└── turbo.json
```

---

## 4. Brand & naming conventions

| Context | Use |
|---------|-----|
| User-facing product | **Guma Kart** |
| Company | Guma Kart Technologies (`apps/web/lib/site-content.ts`) |
| npm packages | `@gumakart/*` |
| Subscription plan IDs (DB / billing) | `free`, `growth`, `pro` (stable forever) |
| Marketing / UI plan names | **Free**, **Pro**, **Advance** (constitution) — from `@gumakart/plans` |
| Handbook mapping | FREE→`free`, PRO→`growth`, ADVANCE→`pro` |
| Aliases (normalize at read) | `starter`→`growth`, `advance`→`pro`, `sulit`→`free` |
| Shop URL display | `{NEXT_PUBLIC_ROOT_DOMAIN}/{slug}` — default host `kart.guma.one` |
| Emails | `hello@guma.one`, `support@guma.one`, `privacy@guma.one` |

**Do not reintroduce** Sulit / Growth / Pro as seller-facing labels, or invent Free/Starter/Growth/Pro as DB IDs. Canonical module: `@gumakart/plans` (ADR D4).

**Do not reintroduce** any legacy pre-rebrand brand names, domains, or package scopes. The brand is **Guma Kart** (`gumakart`) everywhere.

**Internal globals (DB client):** `__gumaKartDb`, `__gumaKartSql` in `packages/db/src/client.ts`.

---

## 5. Architecture (high level)

```mermaid
flowchart TB
  subgraph web [apps/web :3000]
    Storefront["/{slug} storefront"]
    Chat["POST /api/chat"]
    Checkout["POST /api/checkout"]
  end

  subgraph admin [apps/admin :3001]
    AgentsUI["/agents"]
    AIStudio["/ai-studio"]
    Settings["/settings/*"]
    CronAgents["GET /api/cron/agents"]
    CronSMS["GET /api/cron/agent-reminders"]
  end

  subgraph packages [packages]
    AI["@gumakart/ai"]
    DB["@gumakart/db"]
    Auth["@gumakart/auth"]
    Svc["@gumakart/services"]
  end

  Neon[(Neon Postgres)]

  Storefront --> DB
  Chat --> AI
  Chat --> DB
  AgentsUI --> AI
  AgentsUI --> DB
  CronAgents --> AI
  admin --> Auth
  web --> Svc
  admin --> Svc
  DB --> Neon
```

---

## 6. Database

**ORM:** Drizzle · **Production:** Neon (Singapore) · **Local:** Docker Postgres `:5434`.

### Migrations (use these, not `db:push` in prod)

| File | Contents |
|------|----------|
| `packages/db/drizzle/0000_slippery_ultimates.sql` | Core schema (tenants, products, orders, …) |
| `packages/db/drizzle/0001_sweet_mandroid.sql` | Agent tables + enums |

### Agent-related tables (0001)

- `content_queue` — drafted/approved/scheduled/posted social content
- `agent_runs` — run history
- `shop_chat_messages` — buyer chat logs
- `ai_usage_monthly` — quota tracking per tenant/month

### Key queries

| Module | Path |
|--------|------|
| Agents CRUD | `packages/db/src/queries/agents.ts` |
| AI usage counts | `packages/db/src/queries/ai-usage.ts` |
| Order insights (7d) | `packages/db/src/queries/order-insights.ts` |
| Tenant settings types | `packages/db/src/types/tenant-settings.ts` |

### Migration gotcha

A prior `db:push` partially applied agent schema before failing. Fix:

```cmd
pnpm db:reconcile   # if agent tables exist but 0001 not in journal
pnpm db:migrate
```

Inspect DB state: `pnpm db:inspect`.

### Env URL resolution

`packages/db/src/env.ts` supports:

- **Neon + Vercel:** `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct)
- **Local .env:** `DATABASE_URL` (direct), `DATABASE_URL_POOLED` (pooled)

---

## 7. Agents system

### Admin UI — `/agents`

`apps/admin/components/agents-manager.tsx`

- Content queue (approve / skip / copy / mark posted)
- Schedule config (daily/weekly/manual, channels, time)
- Shop assistant settings
- **Daily briefing** — rule-based, grounded in `getOrderInsightsLast7d`
- Usage meters vs plan limits
- Content calendar

### Run agents (manual)

`POST /api/agents/run` — body `{ agentKey: "posting" | "campaign" | "all" }`  
Gated by `assertAiQuota` in `apps/admin/lib/agents/usage-gate.ts`.

### Cron (admin only)

Configured in `apps/admin/vercel.json`:

| Schedule (UTC) | Path | Purpose |
|----------------|------|---------|
| `0 10 * * *` | `/api/cron/agents?mode=daily` | Daily posting agent (~6 PM PHT) |
| `0 2 * * 1` | `/api/cron/agents?mode=weekly` | Weekly campaign agent |
| `0 9 * * *` | `/api/cron/agent-reminders` | SMS nudge (Pro+ / `growth`+) |

Requires `CRON_SECRET` on admin Vercel project. Cron routes also enforce plan quotas.

### Order-aware prompts

`apps/admin/lib/agents/run-agents.ts` uses bestsellers + 7-day order insights in prompts.

### Not built (Phase 2+)

- Meta/TikTok OAuth auto-publish
- Unified Messenger/IG inbox
- LLM-generated briefing (currently rule-based)

---

## 8. AI package

**Path:** `packages/ai/`

| File | Role |
|------|------|
| `@gumakart/plans` (`packages/plans`) | Canonical `PLAN_AI_LIMITS`, catalog, `normalizePlanId` |
| `src/plan-limits.ts` | Thin re-export of `@gumakart/plans` (compat) |
| `src/permissions.ts` | `SCOPE_MATRIX` + approval levels |
| `src/providers/llm.ts` | OpenAI, Gemini, Groq, mock fallback |
| `src/generator.ts` | Template-based generation with plan routing |

### Plan limits (summary)

| Plan ID | Label | Agent runs/week | Chat/day | Generations/mo | SMS reminders | Models |
|---------|-------|-----------------|----------|----------------|---------------|--------|
| `free` | Free | 3 | 25 | 5 | No | gemini-2.0-flash |
| `growth` | Pro | 14 (2/day cap) | 200 | 100 | Yes | gpt-4o-mini |
| `pro` | Advance | 999 (10/day cap) | 2000 | 500 | Yes | gpt-4o-mini posts, gpt-4o campaigns |

**Env for live AI:** `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_AI_API_KEY`), optional `GROQ_API_KEY`.

---

## 9. Settings (admin)

Expandable sidebar under **Settings**. Stored in `tenants.settingsJson`.

| Page | Path | Key |
|------|------|-----|
| Shop | `/settings/shop` | COD, min order, auto-accept |
| Delivery | `/settings/delivery-shipping` | Lalamove/flat rate/pickup |
| Payments | `/settings/payments` | Receiving accounts; **mode is read-only** (Platform activates PayMongo) |
| Notifications | `/settings/notifications` | Email/SMS toggles |
| Subscription | `/settings/subscription` | Plan switch (free/growth/pro) |
| Tracking | `/settings/tracking` | FB Pixel, GA, TikTok Pixel |
| WhatsApp Agent | `/settings/whatsapp-agent` | Seller WA number |

Storefront reads settings for checkout fees, promo banner, tracking pixels, WhatsApp float button.

API: `GET/PATCH /api/settings`. Sellers **cannot** PATCH `payments.mode` (403) — Platform Settings / tenant Admin actions only.

---

## 10. AI Studio

**Path:** `apps/admin/app/ai-studio/` + `components/ai-studio-campaign.tsx`

Dark “Guma Campaign Studio” preview UI. Modules: Brand Kit, Video Studio, Campaign Manager, Auto-publish (**coming soon**). Uses live shop data via `/api/shop`. All Pixury references were replaced with Guma.

---

## 11. Storefront shop assistant

- Component: `apps/web/components/storefront/shop-assistant.tsx`
- API: `apps/web/app/api/chat/route.ts`
- Quota: `apps/web/lib/ai-quota.ts`

---

## 12. Auth

**Package:** `packages/auth/`  
**Admin middleware:** `apps/admin/middleware.ts`

- Email/password + Google OAuth
- Session cookie via `AUTH_SECRET` (32+ chars in production)
- Google callback: `/api/auth/google/callback`
- Signup slug prefix from `shopUrlDisplayPrefix()` in `apps/admin/lib/utils.ts`

---

## 13. Environment variables

Copy from `.env.example`. Minimum for local dev:

```env
DATABASE_URL=...                    # direct (Neon) or local Docker
DATABASE_URL_POOLED=...             # optional local; Neon uses DATABASE_URL as pooled
AUTH_SECRET=...
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3010
NEXT_PUBLIC_ADMIN_URL=http://localhost:3001
NEXT_PUBLIC_ROOT_DOMAIN=kart.guma.one
GEMINI_API_KEY=...                  # recommended for free-tier agents
```

Production / cron / SMS:

```env
CRON_SECRET=...
SEMAPHORE_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Both Next apps load root `.env` via `next.config.ts` (`loadRootEnv()`).

---

## 14. Commands

```cmd
pnpm install

# Dev (prefer dev:clean after build or CSS issues)
pnpm --filter @gumakart/web dev
pnpm --filter @gumakart/admin dev:clean

# Typecheck / build
pnpm turbo build --filter=@gumakart/web --filter=@gumakart/admin

# Database
pnpm db:migrate
pnpm db:reconcile      # one-time fix if needed
pnpm db:seed
pnpm db:studio
pnpm db:generate       # after schema edits → commit new SQL

# Local Docker Postgres
pnpm db:up
```

---

## 15. Known gotchas

| Issue | Fix |
|-------|-----|
| Admin CSS unstyled / webpack `reading 'call'` | Stale `.next` — stop dev, run `dev:clean`. **Never run `turbo build` while dev server is running on same app.** |
| `db:push` primary key errors | Use `db:migrate` + `db:reconcile` instead |
| `relation "content_queue" does not exist` | Run `pnpm db:migrate` against connected DB |
| Admin 500 after deleting `.next` while dev running | Restart dev server |
| Package not found after rebrand | `pnpm install`; scope is `@gumakart/*` |
| Plan shows `free` in DB but UI says Free | Always resolve via `@gumakart/plans` (`planDisplayName` / `SELLER_PLANS`) |

---

## 16. Marketing site audit (fixed vs remaining)

### Fixed in rebrand pass

- Navbar `/#features`, `/#how-it-works`
- FAQ anchors: `#payments`, `#delivery`, `#ai`
- Pricing: Free / Pro / Advance aligned with admin (₱0 / ₱499 / ₱999) via `@gumakart/plans`
- Removed all legacy pre-rebrand brand names and domains
- Blog: removed broken `#` read-more links
- Footer: removed placeholder social `href="#"`

### Still placeholder (OK for pre-beta, fix before launch)

| Item | Location |
|------|----------|
| SEC/BIR registry `[Pending]` | `apps/web/lib/site-content.ts` → footer, about |
| Contact form (no submit API) | `apps/web/app/contact/page.tsx` |
| Status page (static, not monitored) | `apps/web/app/status/page.tsx` |
| Blog (teasers only, no articles) | `apps/web/app/blog/page.tsx` |
| Mobile nav menu (button only) | `apps/web/components/landing/navbar.tsx` |
| Paid billing not wired | subscription-settings copy |

---

## 17. Deployment checklist (not done)

See **`docs/DEPLOY-VERCEL.md`**.

1. Initial git commit + push to GitHub
2. Two Vercel projects: `apps/web`, `apps/admin`
3. Neon ↔ Vercel integration for DB env vars
4. Set all env vars on both projects (Production + Preview)
5. `pnpm db:migrate` against production Neon
6. Google OAuth prod redirect URI on admin domain
7. Enable Vercel cron on admin (Pro plan may be required)
8. Smoke test: login → `/agents` → storefront `/demo` → chatbot

**Build command (each app):**

```bash
cd ../.. && pnpm install && pnpm turbo build --filter=@gumakart/web
# or @gumakart/admin
```

---

## 18. Recommended next work (priority order)

1. **Git + Vercel pre-beta** — first commit, GitHub remote, preview deploy, env vars, migrate prod DB
2. ~~Rename local folder~~ — done; repo now lives at `C:\Users\samga\gumacommerce`
3. **Contact form backend** — email or store inquiries (Resend, Semaphore, etc.)
4. **Meta/TikTok OAuth** — auto-publish from content queue (Phase 2)
5. **Paid billing** — PayMongo subscriptions for Pro/Advance (`growth`/`pro` IDs)
6. **Mobile nav drawer** — marketing site
7. **LLM daily briefing** — optional upgrade over rule-based `buildDailyBriefing`
8. **SEC/BIR + social URLs** — replace placeholders in `site-content.ts`

---

## 19. Key file index

```
packages/db/src/schema/index.ts          — full Drizzle schema
packages/db/src/reconcile-migrations.ts  — migration journal repair
packages/ai/src/plan-limits.ts           — quotas & model routing
packages/ai/src/generator.ts
apps/admin/lib/agents/run-agents.ts
apps/admin/lib/agents/briefing.ts
apps/admin/lib/agents/usage-gate.ts
apps/admin/components/agents-manager.tsx
apps/admin/components/ai-studio-campaign.tsx
apps/admin/app/api/cron/agents/route.ts
apps/admin/app/api/cron/agent-reminders/route.ts
apps/web/app/api/chat/route.ts
apps/web/components/storefront/shop-assistant.tsx
apps/web/lib/site-content.ts             — marketing copy, FAQ, footer links
apps/admin/app/api/settings/route.ts
packages/auth/src/service.ts
apps/admin/middleware.ts
.env.example
```

---

## 20. Session history (what prior agents built)

Chronological summary for context:

1. **Settings menu** — wired saves to DB; storefront applies checkout/delivery/tracking/WhatsApp
2. **Rebrand** — user-facing copy → Guma Kart; bulk rebrand once broke `client.ts` with invalid identifiers (fixed)
3. **AI Studio** — Guma Campaign Studio UI; Pixury → Guma
4. **Agents roadmap** — plan limits, model routing, order-aware agents, daily briefing UI, SMS reminders, shop assistant chatbot
5. **DB** — migration 0001 for agent tables; `db:reconcile` for push drift
6. **Vercel prep** — `vercel.json` crons, DEPLOY-VERCEL.md, `.env.example` expansion
7. **CSS incident** — corrupted `.next` from build+ddev overlap; fixed with `dev:clean`
8. **Full rebrand pass** — legacy npm scope → `@gumakart`, pricing/plan alignment, link fixes, production build verified

**User preference:** No git commits unless explicitly requested (repo still uncommitted at handoff).

---

## 21. Quick verification script

After any major change, run:

```cmd
pnpm --filter @gumakart/admin typecheck
pnpm --filter @gumakart/web typecheck
pnpm turbo build --filter=@gumakart/web --filter=@gumakart/admin
pnpm db:migrate
```

Manual smoke:

- http://localhost:3001/login → dashboard
- http://localhost:3001/agents → briefing + usage meters
- http://localhost:3010/demo → storefront + shop assistant bubble
- Run daily posts (needs `GEMINI_API_KEY` or mock fallback)

---

*End of handoff. For DB details see `DATABASE.md`. For deploy steps see `DEPLOY-VERCEL.md`.*
