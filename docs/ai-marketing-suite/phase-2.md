# Phase 2 — Social Content & Viral Ad Studio

Seller UI: **`/marketing-studio`** in the dashboard (nav: Marketing & AI → Marketing Studio). Three tabs:

| Tab | Route | What it does | Cost / gate |
|---|---|---|---|
| Product photos | `/marketing-studio/photo` | Raw photo → studio scene (Flux.1 Fill + RMBG-2.0), 1:1 and/or 9:16 | 1 photo credit (Starter 20, Pro Live 100, Enterprise unlimited, legacy 20) |
| Video ads | `/marketing-studio/video` | 15/30 s vertical ad: Qwen3 script → F5-TTS voice → Wan 2.1 clips → FFmpeg | 1 video credit (Pro Live 10, Enterprise 40). Custom voice: Enterprise Vibe |
| Taglish copywriter | `/marketing-studio/copywriter` | Hooks, caption, hashtags, auto-reply lines; Save to Post & Attach Comment-to-DM Trigger | 1 monthly AI generation (all plans); triggers Starter+ |

Credits are reserved when the job is created, **consumed on success, refunded on failure** (Phase 1).

## How a render flows
```
browser ─POST /api/ai-media/jobs─► validate (zod, @gumakart/ai/studio) + media ownership
        ─► enqueueAiMediaJob (credit reserved) ─► ai_media_jobs (queued)
bridge dispatcher ─► BullMQ gpu-batch-media (tier priority) ─► pipeline ─► R2/MinIO ─► completed
browser polls GET /api/ai-media/jobs every 3 s while anything is queued/processing
```

### Product photo pipeline (`workers/gpu-bridge/src/pipelines/product-photo.ts`)
1. Fetch the seller's photo. Only from `MEDIA_SOURCE_HOSTS`, https, no redirects, ≤15 MB, magic-byte checked.
2. Upload it to ComfyUI's input folder (`/upload/image`).
3. Qwen3-VL (`LLM_VISION_MODEL`) writes one sentence about the product and its lighting. If that fails, the product title is used instead.
4. Graph `flux_product_studio` (decision D4):
   * RMBG-2.0 mask → product scaled and placed low-centre on the canvas
   * mask inverted, so Flux paints only the background
   * Flux.1 Fill + DifferentialDiffusion paint the scene and contact shadow
   * one branch per aspect, exported at 1080×1080 / 1080×1920
5. **The product's own pixels are never regenerated**, so what buyers see is what they get.

### Video ad pipeline (`pipelines/video-ad.ts`)
Each step is written to `WORK_DIR/<jobId>/` and skipped on retry, so a crash or offline park resumes where it stopped.
1. `script.json`: Qwen3, 3 scenes (hook / body / CTA) with timestamps.
   * Invalid JSON gets one retry, then a deterministic template.
   * Claims not backed by the form (stock counts, "sold", free shipping) are scrubbed (D5).
2. `voice.*`: F5-TTS. Uses a preset reference (`VOICE_PRESETS_DIR/<style>.wav + .txt`) or the merchant's sample + transcript.
3. `clip_0..2.mp4`: Wan 2.1 I2V per scene (480×832, ≤81 frames).
4. `final.mp4`: FFmpeg 1080×1920 30 fps.
   * Short clips are slowed ≤2.5×, then the last frame is held.
   * Voice is sped up ≤1.3× if long; optional bed from `BGM_DIR` at −17 dB, faded out.
   * Kinetic Taglish `.ass` subtitles, with prices in yellow.
   * Last 3 s: end card with shop name, "Order na po!", link, and a QR code to `kart.guma.one/{shop}`.
   * Encoder is NVENC when available, else libx264. NVENC failure retries on libx264.
5. Outputs: the MP4, a thumbnail JPG, and the script JSON.

### Voice clone (`pipelines/voice-clone.ts`, Enterprise Vibe)
The seller uploads a ~10 s recording plus its exact transcript (`/api/ai-media/voice-sample`; stored like product photos under an unguessable name). A `voice_clone` job renders a short preview to approve. Video ads with "Custom Cloned Voice" use the same sample.

## Realtime LLM via the bridge (decision D1)
* Bridge: `POST /v1/realtime/chat` (`src/http-server.ts`).
  * Auth: HMAC `x-guma-signature: v1=hex(HMAC_SHA256(GPU_BRIDGE_SECRET, ts + "." + body))`, ±5 min.
  * Limits: 256 KB body cap; 120 req/min per shop.
  * Answers `503 GPU_NODE_UNAVAILABLE` immediately when the LLM breaker is open.
* Apps: `@gumakart/ai` → `runLocalFirst()` / `callBridgeChat()` (Web Crypto; Workers-safe). Falls back to the cloud model on 530/502–504/timeout/network, and on a refusal (logged).
* Copywriter: `runTaglishCopywriter()` → `POST /api/ai/copywriter`.

## Save to Post & Attach Comment-to-DM Trigger
Migration `0048_studio_post_triggers` adds `social_automation_rules.content_queue_id` and `post_url`.
1. **Save:** creates an approved `content_queue` post (agent `ai_copywriter`) and, for Starter+, a **pending** rule (post_id NULL; never matched by webhooks).
2. **Publish:** the seller posts it on their page, then pastes the link (Facebook / Instagram / TikTok URLs or a numeric/Graph id; parser `parsePostReference`). `PATCH /api/ai/copywriter/posts/[id]` sets `post_id` → rule active.
3. **Phase 3:** the Meta webhook matches comments on that `post_id` against the rule's keywords.

The scope index was rebuilt so a shop still has exactly one global rule and one rule per post, while any number of pending studio rules can coexist.

## API routes (all `requireTenantSession` + `marketing.manage`)
| Route | Purpose |
|---|---|
| `GET /api/ai-media/jobs` | credits + last 30 jobs (gallery, polling) |
| `POST /api/ai-media/jobs` | create `product_photo` / `video_ad` / `voice_clone` (idempotency key supported) |
| `GET /api/ai-media/jobs/[jobId]` | one job |
| `POST /api/ai-media/voice-sample` | Enterprise Vibe recording upload |
| `POST /api/ai/copywriter` | Taglish copy (generation quota) |
| `POST /api/ai/copywriter/save` | Save to Post (+ trigger) |
| `GET /api/ai/copywriter/posts` | saved posts + pending trigger count |
| `PATCH /api/ai/copywriter/posts/[postId]` | attach the published post link |

Shop name and store URL in video payloads come from the session, never from the browser. Every media URL must be the shop's own upload or the shop's own AI output (`assertTenantOwnsMedia`).

## Environment
**Apps (admin):** `GPU_BRIDGE_URL`, `GPU_BRIDGE_SECRET`, optional `GPU_BRIDGE_TIMEOUT_MS`, `GPU_BRIDGE_CF_ACCESS_CLIENT_ID/SECRET`, `AI_MEDIA_PUBLIC_BASE_URL`.
Without the bridge vars the copywriter simply uses the cloud model.

**Bridge:** see `workers/gpu-bridge/.env.example` (Phase 2 block) and [gpu-node-setup.md](gpu-node-setup.md).
