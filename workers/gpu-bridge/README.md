# @gumakart/gpu-bridge

BullMQ bridge between **kart.guma.one** and the home GPU workstation (AI Marketing Suite, Phase 1).

```
 kart.guma.one (Cloudflare Workers)                     gpu-bridge (Node 20+, next to Redis)
 ─────────────────────────────────                      ──────────────────────────────────────
 enqueueAiMediaJob()  ──INSERT──▶  ai_media_jobs  ◀──poll── Dispatcher ──▶ BullMQ gpu-batch-media
   (reserves 1 credit)              (Postgres)                                   │ priority 1…10
                                         ▲                                       ▼
 seller dashboard ◀── NOTIFY ai_media_jobs ── status updates ◀── worker ─▶ ComfyUI /prompt, /history, /view
                                                                         └─▶ R2 / MinIO (outputs)
 Node producers ──▶ BullMQ gpu-realtime ──▶ worker ──▶ vLLM /v1/chat/completions (Qwen3)
```

* **Why the DB hop?** The storefront runs on Cloudflare Workers, which can't hold a Redis TCP
  connection for BullMQ. Apps just insert a row; the dispatcher relays rows to BullMQ in tier
  priority order (Enterprise Vibe = 1 … Starter = 3, Printair mockups = 10).
* **GPU offline (tunnel down, workstation asleep):** a circuit breaker opens after
  `BREAKER_FAILURE_THRESHOLD` failures. While open, the dispatcher sends nothing (jobs wait in
  Postgres) and in-flight jobs are parked as BullMQ delayed jobs — no attempts used, no credits
  lost. Health probes (`/system_stats`, `/models`) close the breaker when the node is back.
* **Realtime** (copywriting, DM closer) never waits on an offline node: it fails immediately with
  `GPU_NODE_UNAVAILABLE` so the caller can fall back to its cloud model.
* **Realtime HTTP (Phase 2, D1):** `POST /v1/realtime/chat` (HMAC-signed) on `BRIDGE_HTTP_PORT`, published via
  cloudflared as `https://bridge.guma.one`. Apps call it through `@gumakart/ai` → `runLocalFirst()` and fall
  back to the cloud model on 530 / 5xx / timeout.
* **Pipelines (Phase 2):** `product_photo` (Flux.1 Fill + RMBG-2.0), `video_ad` (Qwen3 script → F5-TTS → Wan 2.1 →
  FFmpeg), `voice_clone` (F5-TTS preview). Steps are cached in `WORK_DIR` so retries resume.
* **Credits:** reserved when the job is created, consumed on `completed`, refunded once on
  `failed` (including renders whose worker died — see `STUCK_JOB_MS`).

## Run

```powershell
cd "D:\All Apps\gumakart"
pnpm install
pnpm db:migrate                       # applies 0047_ai_marketing_suite
copy workers\gpu-bridge\.env.example workers\gpu-bridge\.env   # then fill it in
pnpm gpu-bridge                       # = pnpm --filter @gumakart/gpu-bridge start
```

Env is read from the process environment (use `dotenvx run -f workers/gpu-bridge/.env -- pnpm gpu-bridge`
or set them in your service manager). See `.env.example` for every variable.

Run it on the GPU workstation itself if you can: ComfyUI and vLLM are then `http://127.0.0.1:…`
and only Redis + Postgres + the bucket need to be reachable.

## Setup check

```powershell
pnpm --filter @gumakart/gpu-bridge doctor
```
Checks every ComfyUI node/input/model the graphs use against your install, plus vLLM, FFmpeg (libass, NVENC),
voice presets, bucket, Redis and DB. See `docs/ai-marketing-suite/gpu-node-setup.md`.

## Job payloads

Typed in `@gumakart/ai/studio` (`productPhotoPayloadSchema`, `videoAdPayloadSchema`, `voiceClonePayloadSchema`).
A payload with `workflow` (a ComfyUI API graph) still runs as-is (Phase 1 contract).
Reference graphs: `workflows/comfyui/*.json` (`pnpm --filter @gumakart/gpu-bridge export-workflows`).

## Tests

```bash
pnpm --filter @gumakart/gpu-bridge test        # unit (no services needed)
DATABASE_URL=postgres://…local REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @gumakart/gpu-bridge test:e2e
```
