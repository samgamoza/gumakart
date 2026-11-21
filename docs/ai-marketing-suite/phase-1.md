# AI Marketing Suite — Phase 1: how the plan maps onto this codebase

`IMPLEMENTATION_PLAN.md` was written assuming Supabase. GumaKart runs on **Neon Postgres +
Drizzle + Cloudflare Workers**, so Phase 1 was built on what exists:

| Plan says | Built as | Why |
|---|---|---|
| `supabase/migrations/20261121_ai_marketing_suite.sql` | `packages/db/drizzle/0047_ai_marketing_suite.sql` (+ journal entry, `MIGRATION_HEAD`) | `pnpm db:migrate` / drizzle-kit only runs files in `packages/db/drizzle` that are in the journal; CI checks Neon has the head migration before deploy |
| `merchants` / `merchant_id` | `tenants` / `tenant_id` | every shop table uses `tenant_id`; tenant-scope guard test |
| legacy `pro` ₱499 / `advance` ₱999 | stored ids `growth` (Pro ₱499) / `pro` (Advance ₱999) | ADR-0001 D4 ids are permanent; `pro` ≠ new Pro Live |
| `subscription_tiers` | table seeded from `AI_SUITE_TIERS` (`@gumakart/plans/src/ai-suite.ts`) | test `ai-suite-catalog.test.ts` fails if they drift |
| `merchant_entitlements` | table, one row per shop, synced from `tenants.subscription_plan` by trigger | PayMongo billing flow untouched; admin overrides via `limits_overridden` |
| credit metering | `ai_suite_reserve_credit()` / `ai_suite_refund_credit()` (atomic, calendar month PH time) | reserve at enqueue → consume on completed → refund on failed; no overspend under concurrency |
| `ai_media_jobs` | table as specified + credit/idempotency/dispatch columns | |
| Supabase Realtime | `pg_notify('ai_media_jobs', …)` trigger on status change | Phase 2 streams it to the dashboard (Workers can't LISTEN → SSE from a Node host, or poll `getAiMediaJob`) |
| Supabase Storage / MinIO | S3-compatible driver (Cloudflare R2 or MinIO) via `aws4fetch` | |
| `social_connections` | existing `social_accounts` + `ig_business_id`, `phone_number_id`, `waba_id`, `webhook_token_sealed` | tokens already sealed with AES-GCM (`access_token_sealed`) |
| `social_conversations` | existing `social_threads` + `active_checkout_link_id`, `ai_context_json`, `nudge_sent_at`, `conversion_status`, `ai_paused`, `escalation_reason` | messages already in `social_messages`; `last_buyer_message_at` = `last_inbound_at` |
| `social_automation_rules`, `abandoned_cart_nudges`, `buyer_crm_segments`, `broadcast_campaigns` | new tables | CRM rebuild: `refresh_buyer_crm_segments(tenant_id)` (Phase 4 schedules it) |
| BullMQ `gpu-realtime` / `gpu-batch-media` | `workers/gpu-bridge` | apps enqueue media via Postgres; the bridge's dispatcher relays to BullMQ |

## Tier → existing feature gates

`normalizePlanId()` (all existing gates, `PLAN_AI_LIMITS`, automations):
`starter → growth` (Pro features), `pro_live`/`enterprise_vibe → pro` (Advance features).
Existing `growth`/`pro` subscribers: unchanged features, grandfathered, plus Starter-level
AI media (20 photo credits/month).

## Not done in Phase 1 (deliberately)

* Sellers can't **buy** the new tiers yet — by decision D2 public checkout keeps selling
  `growth`/`pro` until the end of Phase 5; super-admins assign new tiers from the platform app.
* ComfyUI workflow builders (Flux / Wan / F5) — done in Phase 2 (`phase-2.md`).
