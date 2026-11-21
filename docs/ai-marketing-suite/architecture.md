# Architecture — kart.guma.one ↔ home GPU node

```
 Seller browser
   │  /marketing-studio  (polls /api/ai-media/jobs while a job is running)
   ▼
 apps/admin  (Next.js on Cloudflare Workers)
   │  media:    enqueueAiMediaJob() ──INSERT──► Neon: ai_media_jobs  (credit reserved)
   │  realtime: signed POST ─────────────────► https://bridge.guma.one/v1/realtime/chat
   │            └─ 530 / 5xx / timeout ──► cloud model (OpenAI / Gemini / Groq) — D1
   ▼
 Cloudflare Tunnel ───────────────────────────────────────────────────────────────┐
                                                                                   ▼
 Home workstation
   gpu-bridge (Node)  ── Redis (BullMQ: gpu-realtime, gpu-batch-media)
     ├─ HTTP server   :8790  /healthz, /v1/realtime/chat (HMAC)  → gpu-realtime → vLLM (Qwen3)
     ├─ Dispatcher    Neon ai_media_jobs ─► gpu-batch-media (priority 1…10)
     ├─ Pipelines     product_photo · video_ad · voice_clone (ComfyUI + FFmpeg)
     └─ Storage       R2 / MinIO (public URLs written back to ai_media_jobs.output_urls)
   ComfyUI :8188  (Flux.1 Fill, RMBG-2.0, Wan 2.1 I2V, F5-TTS)
   vLLM    :8000  (Qwen3 text, Qwen3-VL vision)
```

## Why it's shaped this way
* **Workers can't open Redis TCP connections** (BullMQ needs them). Media jobs therefore travel
  through Postgres; the bridge relays them. Realtime calls go over HTTPS to the bridge.
* **The GPU node is a home machine** — it sleeps, reboots and loses internet. Circuit breakers
  hold media jobs (nothing fails, no credit lost) and make realtime fail fast to the cloud model.
* **Credits are metered in Postgres** (`ai_suite_reserve_credit`) at enqueue time, so concurrent
  submits can't overspend; failures refund exactly once.
* **The bridge downloads only from allowed hosts** (`MEDIA_SOURCE_HOSTS`) — it sits on the home
  LAN, so arbitrary URLs from job payloads would be an SSRF hole.

## Trust boundaries
| Boundary | Control |
|---|---|
| Browser → admin API | `requireTenantSession()` + staff permission; tenant-scoped queries |
| Admin → bridge HTTP | HMAC-SHA256 over `timestamp.body` (`GPU_BRIDGE_SECRET`, ±5 min); optional Cloudflare Access service token |
| Bridge → internet | allowlisted source hosts only; outputs to one bucket under `ai-media/<tenant>/<job>/` |
| Bridge → Postgres | worker-only queries marked `tenant-scope: system`, keyed by job id |
