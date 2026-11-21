# Phase 5 — Printair packaging upsell & public tier switchover

## 5.1 Branded packaging mockups
* **Trigger** (`/api/cron/printair`, hourly):
  * the shop's first completed Marketing Studio render (`product_photo` / `video_ad`);
  * or 10 / 50 / 100 / 500 completed orders. Only the highest milestone reached counts, so a shop already at 120 orders gets one offer. Each milestone fires once (`printair_upsells`, unique per shop + milestone).
* **Job:** `ai_media_jobs.job_type = 'printair_mockup'`, priority 10 (slow lane), no credit. Payload (`printairMockupPayloadSchema`): shop name, store URL, logo URL, brand colour, tagline.
* **Bridge pipeline** (`workers/gpu-bridge/src/pipelines/printair-mockup.ts`, each step cached):
  1. Logo (optional — a missing or broken logo makes a text-only design) and QR to the shop.
  2. FFmpeg + libass flats at 300 dpi. Text uses `SUBTITLE_FONT`.

     | Item | Size | Background |
     |---|---|---|
     | Thank-you card | 4×6 in, 1200×1800 | light brand tint |
     | Parcel sticker | 3×3 in, 900×900 | brand colour, auto-contrast ink |
     | Mailer-box front panel | 8×6 in, 2400×1800 | |
  3. `print_ready.pdf`: one page per item at its real size (JPEG pages, no fonts).
  4. Flux.1 Fill graph `printair_mockup`: each flat is placed on a 1024² canvas, the whole flat is protected, and only the scene around it is painted. Exported at 1080×1080.
* **Outputs** (`ai_media_jobs.output_urls`): `mockup:<item>` ×3, `flat:<item>` ×3, `print_pdf`.

## 5.2 "Order on Printair"
* The dashboard card (`PrintairUpsellCard`) shows the mockups. It can be dismissed (`POST /api/printair {action:"dismiss"}`).
* **Order on Printair:** `POST /api/printair {action:"handoff"}`. This needs the `billing.manage` permission and `GUMA_ECOSYSTEM_JWT_SECRET`. It returns `https://printair.guma.one/api/import-from-gumakart?token=<JWT>`, and the browser goes there.
* The token contract is in [printair-handoff.md](printair-handoff.md).

## 5.3 Public tier switchover (D2)
* **Single source:** `PUBLIC_PLANS`, `PAID_PLAN_PRICES_PHP`, `canPurchasePlan` and `tierDisplayName` in `@gumakart/plans`.

  | Plan | Price / month |
  |---|---|
  | Free | ₱0 |
  | Starter | ₱999 |
  | Pro Live (most popular) | ₱2,999 |
  | Enterprise Vibe | ₱5,999 |
* **Where it shows:**
  * landing pricing: `apps/web/components/landing/pricing.tsx`, `Frontend3Landing.tsx`;
  * the storefront upgrade hint;
  * `/settings/subscription` (4 cards; a grandfathered shop sees a note and can renew);
  * billing status and notices (`tierDisplayName`).
* `POST /api/billing/upgrade` accepts `starter | pro_live | enterprise_vibe`. It accepts `growth | pro` only when the shop is already on that plan (renewal at ₱499 / ₱999).
* **After payment:** the PayMongo webhook calls `markPlanPaymentPaidByIntent`, which sets `tenants.subscription_plan`. The 0047 trigger then syncs `merchant_entitlements` (credits, closer, broadcasts…).
* Super-admins can still assign any tier in the ops console.
