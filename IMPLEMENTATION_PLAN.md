# GumaKart AI Social Marketing & Commerce Suite — Implementation Plan

> **Revised 2026-11-21 after Phase 1.** The first draft assumed Supabase. This version describes
> the stack GumaKart actually runs on, and records the decisions taken so far. Per-phase detail
> lives in `docs/ai-marketing-suite/`.

## 0. System context & architecture rules

### Ecosystem
* **Parent:** Guma One Technologies (SGG Ventures, LLC)
* **GumaKart storefront + seller dashboard:** `https://kart.guma.one`
  * `apps/web` — buyer storefront (Next.js 15 on Cloudflare Workers via OpenNext)
  * `apps/admin` — seller dashboard + `/api/*` (Next.js 15 on Cloudflare Workers; 1-minute cron trigger)
  * `apps/platform` — super-admin console
* **Printair cross-sell:** `https://printair.guma.one`
* **BayanGo logistics:** internal dispatch & rate API (`packages/services/src/delivery/bayango*`), Lalamove fallback

### Data & code layout (what the plan's wording maps to)
| Draft said | Actually |
|---|---|
| Supabase Postgres | **Neon Postgres**, Drizzle ORM (`packages/db`). App runtime connects through Cloudflare Hyperdrive. |
| `supabase/migrations/*.sql` | **`packages/db/drizzle/NNNN_name.sql`** + an entry in `drizzle/meta/_journal.json` + `MIGRATION_HEAD` (`src/migration-head.ts`). `pnpm db:migrate`. CI refuses to deploy code whose migration isn't on Neon yet. |
| `merchants`, `merchant_id` | **`tenants`, `tenant_id`**. Every shop-owned write names the tenant (enforced by `tenant-scope.test.ts`). |
| Supabase Realtime | `pg_notify('ai_media_jobs', …)` on status changes. Workers can't `LISTEN`, so the dashboard **polls** `GET /api/ai-media/jobs` while a job is in flight. |
| Supabase Storage / MinIO | **S3-compatible bucket (Cloudflare R2 or MinIO)** written by the GPU bridge; seller uploads keep using the existing Vercel Blob / R2 product-upload path. |
| `/app/dashboard/...` | `apps/admin/app/...` (e.g. `/marketing-studio/photo`). APIs at `apps/admin/app/api/...`. |
| Plan prices/limits anywhere | **Only in `@gumakart/plans`** (ADR-0001 D4). DB tier table mirrors it; a test fails on drift. |
| "Pro" ₱499 / "Advance" ₱999 | Stored plan ids **`growth`** (Pro ₱499) and **`pro`** (Advance ₱999) — permanent ids. New tiers: `free`, `starter`, `pro_live`, `enterprise_vibe`. |

### Local GPU compute node (home workstation, Cloudflare Tunnel)
* `LLM_BASE_URL` — vLLM, OpenAI-compatible, **Qwen3** (text) and **Qwen3-VL** (vision): `https://llm-node.guma.one/v1`
* `COMFY_BASE_URL` — **ComfyUI** with Flux.1 Fill, RMBG-2.0, Wan 2.1 I2V, F5-TTS: `https://gpu-node.guma.one`
* **GPU bridge** — `workers/gpu-bridge` (Node 20+, runs on the workstation next to Redis):
  * BullMQ queues `gpu-realtime` (LLM, high concurrency, fast timeout) and `gpu-batch-media` (ComfyUI, priority 1 = Enterprise Vibe … 10 = Printair mockups).
  * **Media jobs** — apps insert an `ai_media_jobs` row (`enqueueAiMediaJob`, which reserves a credit). The bridge's dispatcher relays rows to BullMQ. Cloudflare Workers never talk to Redis.
  * **Realtime LLM** — signed HTTP endpoint `POST /v1/realtime/chat` on the bridge, exposed through the tunnel (e.g. `https://bridge.guma.one`). Apps call it with an HMAC-signed request and **fall back to the cloud model** (OpenAI / Gemini / Groq via `callLlm`) on 530 / 502–504 / timeout / network error. (Decision 1.)
  * **Resilience** — circuit breaker per node. While open: media jobs wait in Postgres or are parked as delayed BullMQ jobs (no attempts used, no credits lost); realtime fails fast so callers fall back.
  * **SSRF guard** — the bridge only downloads source media from `MEDIA_SOURCE_HOSTS` (storefront, Blob, media bucket).

### Decisions log
| # | Date | Decision |
|---|---|---|
| D1 | 2026-11-21 | Realtime LLM (copywriter, AI closer) goes through a small authenticated HTTP endpoint on the GPU bridge, exposed via the tunnel, with graceful cloud fallback on 530/timeout. |
| D2 | 2026-11-21 | Public checkout and subscription pages **keep selling the legacy plans** (`growth` ₱499, `pro` ₱999) until the **end of Phase 5**. New tiers are assigned by super-admins (platform app) for testing. Switch-over is the last task of Phase 5. |
| D3 | 2026-11-21 | Grandfathered legacy shops (`growth`, `pro`) keep **20 photo credits / month** (Starter-level AI media). |
| D4 | 2026-11-21 | Product photos use **Flux.1 Fill outpainting around the background-removed product** (product pixels are never regenerated), instead of ControlNet-depth re-synthesis. Qwen3-VL describes the product (run by the bridge). |
| D5 | 2026-11-21 | Scarcity / free-shipping claims in AI copy are only made when backed by real data (stock count, the shop's free-shipping setting). The model is told not to invent numbers. |

---

## Phase 1 — Database, tier upgrade & GPU queue backbone ✅ (2026-11-21)
Details: `docs/ai-marketing-suite/phase-1.md`.
* Migration `0047_ai_marketing_suite.sql`:
  * `subscription_tiers` and `merchant_entitlements`, kept in sync with `tenants.subscription_plan` by a trigger.
  * Atomic monthly credits (`ai_suite_reserve_credit` / `ai_suite_refund_credit`, PH calendar month).
  * `ai_media_jobs` with a NOTIFY trigger; `social_automation_rules`; `abandoned_cart_nudges`; `buyer_crm_segments` + `refresh_buyer_crm_segments()`; `broadcast_campaigns`.
  * Social connections and conversations extend the existing `social_accounts` / `social_threads`.
* `@gumakart/plans/src/ai-suite.ts` tier catalog; `normalizePlanId` maps `starter→growth`, `pro_live`/`enterprise_vibe→pro` for existing gates.

| Tier | ₱/mo | Photo credits | Video credits | AI closer | Broadcast | Voice clone | Vibe coding | Queue priority |
|---|---|---|---|---|---|---|---|---|
| free | 0 | 0 | 0 | – | – | – | – | 4 |
| starter | 999 | 20 | 0 | static auto-reply | – | – | – | 3 |
| pro_live | 2,999 | 100 | 10 | ✓ | ✓ | – | – | 2 |
| enterprise_vibe | 5,999 | unlimited | 40 | ✓ | ✓ | ✓ | ✓ | 1 |
| growth (legacy Pro) | 499 | 20 | 0 | – | – | – | – | 3 |
| pro (legacy Advance) | 999 | 20 | 0 | – | – | – | – | 3 |

* `workers/gpu-bridge`: dispatcher (outbox relay), circuit breakers, ComfyUI client, S3 storage, realtime + batch processors.

## Phase 2 — Social Content & Viral Ad Studio
Goal: `/marketing-studio` in the seller dashboard for zero-API-cost creative generation on the home GPU. Details: `docs/ai-marketing-suite/phase-2.md`.

### 2.0 Bridge realtime endpoint (D1)
* `workers/gpu-bridge/src/http-server.ts`: `GET /healthz`, `POST /v1/realtime/chat`.
  * Auth: `x-guma-timestamp` + `x-guma-signature: v1=hex(HMAC-SHA256(GPU_BRIDGE_SECRET, ts + "." + body))`, 5-minute window. Optional Cloudflare Access service token.
  * The request is enqueued on `gpu-realtime` and awaited. Errors: `503 GPU_NODE_UNAVAILABLE`, `504` timeout.
* `packages/ai/src/gpu-bridge-client.ts`: Workers-compatible signer (Web Crypto) + `runLocalFirst()` (bridge → cloud fallback).

### 2.1 1-click studio product photography (Flux.1 Fill + RMBG-2.0)
* UI `apps/admin/app/marketing-studio/photo/page.tsx`:
  * Upload, or pick a product photo.
  * Scene presets: Cozy Manila Condo, Tropical Boracay Beach, Minimalist Clean Studio, Warm Cafe Wooden Table, or a custom prompt.
  * Aspect: 1:1 (1080×1080), 9:16 (1080×1920), or both.
* API `POST /api/ai-media/jobs` → `enqueueAiMediaJob` (1 photo credit reserved; consumed on completed, refunded on failed).
* Bridge pipeline `product_photo`:
  1. Fetch the source from an allowed host, then upload it to ComfyUI.
  2. Qwen3-VL describes the product and its lighting.
  3. Graph `flux_product_studio`: LoadImage → RMBG-2.0 → scale and place on canvas → Flux.1 Fill outpaint (background + contact shadow) → 1080 exports.
* Reference graph: `workers/gpu-bridge/workflows/comfyui/flux_product_studio.json`.

### 2.2 Short-form video ads (Wan 2.1 I2V + F5-TTS)
* UI `apps/admin/app/marketing-studio/video/page.tsx`. Gated to Pro Live (10/mo) and Enterprise Vibe (40/mo).
  * Seller picks 1–3 images, price / promo, and a voice: Energetic Filipina Seller, Casual Taglish Kuya, or a Custom Cloned Voice (Enterprise Vibe; sample uploaded via `/api/ai-media/voice-sample`).
  * Duration 15 s or 30 s.
* Bridge pipeline `video_ad` (each step cached on disk, so retries resume):
  1. Qwen3 writes a 3-scene Taglish hook → body → CTA script with timestamps.
  2. F5-TTS voiceover, from a preset reference voice or the merchant sample.
  3. Wan 2.1 I2V clip per scene (480×832, upscaled).
  4. FFmpeg (NVENC when available, else libx264): 1080×1920 30 fps, voice + optional royalty-free bed from `BGM_DIR`, burned-in kinetic `.ass` Taglish subtitles, end card with the `kart.guma.one/{shop}` QR code and link. A thumbnail is also produced.
* `voice_clone` job (Enterprise Vibe): renders a short preview with the merchant's sample so they can approve it.

### 2.3 Taglish viral copy & hook generator (Qwen3 via bridge)
* `packages/ai/src/taglish-copywriter.ts`: PH social-commerce system prompt (hooks, COD/GCash/Maya trust badges, `#TikTokFindsPH`, `#BudolFinds`, `#SupportLocalPH`). Honest scarcity only (D5).
* `POST /api/ai/copywriter` (monthly AI generation quota) — local Qwen3 first, cloud fallback.
* `POST /api/ai/copywriter/save` — **"Save to Post & Attach Comment-to-DM Trigger"**:
  * Creates a `content_queue` post (approved) and a pending `social_automation_rules` row linked to it (Starter tier and up).
  * Once the seller publishes and pastes the post link or ID (`PATCH /api/ai/copywriter/posts/[id]`), the rule becomes active for that `post_id`.
  * Phase 3's webhook acts on it.

## Phase 3 — Comment-to-DM & 24/7 Taglish AI Sales Closer ✅ (2026-11-21)
Goal: replace manual "PM sent!" with automated comment capture, Taglish objection handling, live BayanGo quotes and abandoned-cart rescue. Details: `docs/ai-marketing-suite/phase-3.md`.

Migration `0049_social_closer.sql` (additive): `social_comment_actions` (unique per account + comment → retries are harmless), `social_accounts.ai_closer_mode` (auto/off per Page, IG account or WhatsApp number), `social_threads.checkout_link_sent_at`, `checkout_links.prefill_json`, unique `abandoned_cart_nudges (thread_id, checkout_link_id)`.

### 3.1 Unified webhook ingestion
* `apps/admin/app/api/webhooks/meta` (extended): Messenger + Instagram DMs, Facebook Page `feed` comments, Instagram `comments`, button postbacks. `X-Hub-Signature-256` with `META_APP_SECRET`. The Page subscription now includes `feed`.
* `apps/admin/app/api/webhooks/whatsapp` (new): WhatsApp Cloud API. Signed with `WHATSAPP_APP_SECRET` (falls back to `META_APP_SECRET`); verify token `WHATSAPP_VERIFY_TOKEN` (falls back to `META_VERIFY_TOKEN`). Numbers are connected in Channels (`POST /api/channels/whatsapp`, token checked against the number, stored sealed).
* Both answer 200 fast; comment handling and the AI run after the response (`next/server` `after`, i.e. `waitUntil` on Workers). Both are registered in `scripts/route-audit.test.mjs`.
* TikTok: no public comment/DM webhook for shops yet — deferred (not in this phase).
* Comment-to-DM (Starter+): rule for the post (or the shop's global rule) → Taglish keyword match (hm, how much, magkano, mine, avail, meron pa, details, pa-PM… whole words, 1 typo for long words) → one Meta **Private Reply** with the product card and a ready checkout link (or the product page when it has options) → a randomized public reply (`{name}` filled). Own comments, repeats and the same commenter on the same post within 24 h are skipped.
* **pfbid lookup** (`packages/services/src/channels/meta.ts`): `resolveFacebookPostId` scans the connected Page's `published_posts` + `videos` to turn newer share links (`/posts/pfbid0…`, `permalink.php?story_fbid=pfbid…`, reels) into `<pageId>_<postId>`; `resolveInstagramMediaId` turns `/p/<shortcode>` into the IG media id. Used by `PATCH /api/ai/copywriter/posts/[id]` when a seller attaches a pending trigger.

### 3.2 24/7 Taglish AI sales closer (`packages/ai/src/agents/taglish-closer.ts`)
* Runs when `merchant_entitlements.ai_closer_enabled` (Pro Live, Enterprise Vibe) **and** the account's `ai_closer_mode = 'auto'`, the chat isn't paused, the newest message is the buyer's and no human seller typed in the last 15 minutes. Daily cap = the plan's `chatMessagesPerDay`.
* Model: Qwen3 through the signed bridge endpoint with **native tool calls** (vLLM `--enable-auto-tool-choice --tool-call-parser hermes`). If the node is down (530 / 503 / timeout) mid-turn, the same turn continues on the cloud model with a JSON action protocol and the tool results so far.
* Tools (bound server-side to the shop + chat):
  * `check_product_inventory` — real prices and stock; an exact count only when the shop tracks stock (D5).
  * `quote_bayango_delivery` — BayanGo rate engine, Lalamove fallback, else the shop's flat rate; free delivery only from the shop's own minimum.
  * `create_prefilled_checkout_link` — GCash / Maya / QRPh / COD (only methods the shop can take), the buyer's details stored on the link (`prefill_json`, never in the URL, hidden after the first order); the storefront `/c/[code]` page opens pre-filled.
  * `escalate_to_human_seller` — `ai_paused` + `escalation_reason`, push alert to the seller; the inbox shows "AI paused — Let AI continue".
* Guards: ₱ amounts not seen in tool results or the chat → one corrective step, then removed; stock counts / "sold" numbers / free shipping not backed by tool results are scrubbed; 5 steps max, then hand over.
* Meta's 24-hour window is enforced by `beginSocialSend`. A 2-minute cron sweep answers chats a background run missed.

### 3.3 Abandoned-cart & ghost-buyer recovery
* `/api/cron/social-ai`, every 2 minutes (one admin Worker cron trigger, `CRON_SECRET`).
* Picks chats whose active checkout link went out ≥ 30 minutes ago with no order (ghost buyer) or an unpaid order, still inside the 24-hour window minus a 30-minute margin, not paused, not nudged for that link. `claimCartNudge` inserts into `abandoned_cart_nudges` first (unique per chat + link).
* One Taglish nudge (AI-personalised on Pro Live / Enterprise Vibe, template on Starter): never says the item is "reserved"; mentions BayanGo only when it's configured. Buttons: **Finish my order / Complete Payment** (the buyer's own order page when an unpaid order exists) and **Switch to COD** (ghost buyers, when the shop takes COD and the link isn't COD) → a fresh pre-filled COD link.
* Paid / COD orders mark the chat `converted`.

## Phase 4 — Buyer CRM segments, payday & restock broadcasts, BayanGo review loop ✅ (2026-11-21)
Details: `docs/ai-marketing-suite/phase-4.md`. Migration `0050_ai_suite_growth.sql` (shared with Phase 5, additive).

* **4.1 Segments.** `/api/cron/segments` nightly (18:45 UTC = 02:45 Manila) runs `refresh_buyer_crm_segments(tenant_id)` (0047) for every active shop with orders:
  * `VIP_REPEAT`: 3+ orders.
  * `PAYDAY_SHOPPER`: at least half of orders on the 13th–17th / 28th–31st (Manila).
  * `INACTIVE_60D`: no order in 60+ days.
  * Counts are shown on `/campaigns/broadcasts`.
* **4.2 Broadcasts** (`/campaigns/broadcasts`, Pro Live / Enterprise Vibe via `broadcast_enabled`):
  * Payday prompt on the 14th and 29th: a dashboard banner, plus a push at 09:05 Manila (`/api/cron/payday-alerts`).
  * Qwen3 polishes the seller's draft once per campaign: local GPU first, cloud fallback, claims scrubbed (D5). The seller approves the text.
  * Each buyer gets their own `{name}`, `{item}` (last item) and `{link}`. The link is `kart.guma.one/{shop}/reorder/{last_order_id}` → a fresh checkout link with the same still-for-sale items, or the product page for restocks.
  * Recipients are frozen at queue time (`broadcast_recipients`), together with how each can be reached:
    * Messenger / IG: only buyers inside 24 h of their last message.
    * WhatsApp: a free-form message inside the 24 h window; outside it, only an approved template (`{{1}}` name, `{{2}}` link), and only to opted-in buyers.
    * Opt-outs are skipped.
  * `/api/cron/broadcasts` (odd minutes) sends at ≤ 10 msg/s (`rate_limit_per_sec`). It re-checks the window per message, and stops if the shop loses the plan.
* **4.3 BayanGo review loop.**
  * `POST /api/webhooks/bayango/status` (storefront app, also the old `/api/webhooks/bayango` URL) is signed with `BAYANGO_WEBHOOK_SECRET` and accepts `delivery.completed` or a status change to `delivered`. It schedules a `review_prompts` row due 2 h later, once per order.
  * `/api/cron/review-loop` (:x3 / :x8) asks in the buyer's chat (order thread → customer thread → WhatsApp by phone):
    * inside 24 h: a free-form message;
    * WhatsApp outside 24 h: the approved Utility template (`ai_suite_settings.wa_review_template`);
    * Messenger outside 24 h: skipped.
  * The buyer's reply (`5`, `⭐⭐⭐⭐`, `lima po`, `10/10`, plus optional photos re-hosted from Meta's CDN) is caught before the AI closer:
    * a verified `product_reviews` row is published per item on the delivered order;
    * a **single-use** voucher is issued (`gift_cards.single_use`; ₱50 / 30 days by default, set per shop).

## Phase 5 — Printair packaging upsell & public tier switchover ✅ (2026-11-21)
Details: `docs/ai-marketing-suite/phase-5.md`.

* **5.1 Mockups.**
  * Trigger: `/api/cron/printair` (hourly) finds shops whose first Marketing Studio render completed, or that reached 10 / 50 / 100 / 500 completed orders. Only the highest milestone reached counts, and each milestone fires once (`printair_upsells`).
  * It enqueues `printair_mockup` (priority 10, no credit).
  * The bridge pipeline composes print-ready 300 dpi flats with FFmpeg + libass: thank-you card 4×6 in, parcel sticker 3×3 in, mailer-box panel 8×6 in, using the shop's **real logo**, brand colour, tagline and QR code. It wraps them in one print PDF.
  * Flux.1 Fill then paints a photo scene around each protected flat (D4 approach; no IP-Adapter needed, since the logo pixels are never regenerated).
* **5.2 Order on Printair.**
  * A dismissible dashboard card shows the mockups. "Order on Printair" is a `POST /api/printair` that signs a 5-minute HS256 JWT with `GUMA_ECOSYSTEM_JWT_SECRET`. Claims: `iss=gumakart`, `aud=printair`, `merchant_id = tenant_id`, `brand_assets`, `mockups`, `print_ready_pdf_url`, `shipping_address`, `jti`.
  * The seller is redirected to `https://printair.guma.one/api/import-from-gumakart?token=…`.
  * Verifier contract: `docs/ai-marketing-suite/printair-handoff.md`.
* **5.3 (D2) Switchover.**
  * `PUBLIC_PLANS` (`@gumakart/plans`) is what the landing pricing, the subscription page and `POST /api/billing/upgrade` sell: Free ₱0 · Starter ₱999 · Pro Live ₱2,999 · Enterprise Vibe ₱5,999.
  * Grandfathered `growth` (₱499) / `pro` (₱999) shops keep their plan and can renew it (`canPurchasePlan`); nobody new can buy them.
  * PayMongo → `markPlanPaymentPaidByIntent` sets `subscription_plan`, and the 0047 trigger syncs `merchant_entitlements`.

---

## Execution protocol
One phase per session. Each phase ends with:
* zero type errors across all packages, apps and the worker
* unit, DB-integration and bridge tests, compared against a baseline run
* a summary
* a pause for confirmation before the next phase
