# GPU workstation setup (Phase 2)

Everything below runs on the home GPU machine. When you're done, `pnpm --filter @gumakart/gpu-bridge doctor`
must print **All checks passed** — it validates the exact node classes, inputs and model file names
the pipelines send against *your* ComfyUI (`/object_info`), plus vLLM, FFmpeg, voices, bucket, Redis and DB.

## 1. ComfyUI
Install recent ComfyUI. Core nodes used: `LoadImage`, `ImageScale`, `MaskToImage`, `ImageToMask`, `EmptyImage`, `ImageCompositeMasked`, `SolidMask`, `MaskComposite`, `GrowMask`, `InvertMask`, `UNETLoader`, `DualCLIPLoader`, `CLIPLoader`, `VAELoader`, `CLIPTextEncode`, `FluxGuidance`, `InpaintModelConditioning`, `DifferentialDiffusion`, `KSampler`, `VAEDecode`, `SaveImage`, `CLIPVisionLoader`, `CLIPVisionEncode`, `ModelSamplingSD3`, `WanImageToVideo`, `CreateVideo`, `SaveVideo`, `LoadAudio`, `SaveAudio`.

Custom node packs:
| Pack | Node used | Override env if the class name differs |
|---|---|---|
| ComfyUI-RMBG (RMBG-2.0) | `RMBG` | `COMFY_NODE_RMBG` |
| ComfyUI-F5-TTS | `F5TTSAudioInputs` | `COMFY_NODE_F5TTS` |

Models (file names are env-configurable; defaults shown):
| Folder | File | Env |
|---|---|---|
| `models/diffusion_models` | `flux1-fill-dev.safetensors` | `FLUX_FILL_UNET` |
| `models/text_encoders` | `clip_l.safetensors`, `t5xxl_fp8_e4m3fn.safetensors` | `FLUX_CLIP_L`, `FLUX_T5` |
| `models/vae` | `ae.safetensors` | `FLUX_VAE` |
| `models/diffusion_models` | `wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors` | `WAN_I2V_UNET` |
| `models/text_encoders` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `WAN_TEXT_ENCODER` |
| `models/vae` | `wan_2.1_vae.safetensors` | `WAN_VAE` |
| `models/clip_vision` | `clip_vision_h.safetensors` | `WAN_CLIP_VISION` |
| (RMBG pack downloads) | `RMBG-2.0` | `RMBG_MODEL` |

Reference graphs to load in ComfyUI (Workflow → Open, API format): `workers/gpu-bridge/workflows/comfyui/*.json`.

## 2. vLLM
Serve Qwen3 (text) and Qwen3-VL (vision) behind the OpenAI-compatible API. Set `LLM_MODEL` / `LLM_VISION_MODEL` to the served model ids (`GET /v1/models`).

Phase 3 (AI sales closer) uses native tool calling — start the text model with:
```
vllm serve Qwen/Qwen3-... --enable-auto-tool-choice --tool-call-parser hermes
```
Without these flags vLLM rejects requests that carry `tools`; the closer then falls back to the cloud model for every turn (still works, just not free).

Phase 5 (Printair mockups) needs nothing new on the node: it reuses Flux.1 Fill (graph `printair_mockup.json`), and FFmpeg + libass + `SUBTITLE_FONT` for the print-ready flats.

## 3. FFmpeg
A build with **libass** (subtitles) and libx264; NVENC (`h264_nvenc`) is used automatically when present.
`ffprobe` must sit next to `ffmpeg` (or on PATH). Windows: a "full" build from gyan.dev works.

## 4. Voices and music
* `VOICE_PRESETS_DIR/energetic_filipina.wav` + `energetic_filipina.txt` (exact transcript), and the same for `casual_kuya`. Clean 8–12 s recordings you have the rights to.
* Optional `BGM_DIR` with royalty-free tracks you have licensed for commercial ads.

## 5. Bucket
Cloudflare R2 (or MinIO), public read through `MEDIA_PUBLIC_BASE_URL` (e.g. `https://media.guma.one`). Set the same value as `AI_MEDIA_PUBLIC_BASE_URL` in the admin app.

## 6. Tunnel
`cloudflared` publishes:
* `llm-node.guma.one` → vLLM
* `gpu-node.guma.one` → ComfyUI
* `bridge.guma.one` → `http://127.0.0.1:8790` (bridge HTTP)

Recommended: protect `llm-node` and `gpu-node` with Cloudflare Access and set `CF_ACCESS_CLIENT_ID/SECRET` on the bridge. If the bridge runs on the same machine, point it at `http://127.0.0.1` instead and don't publish ComfyUI at all.
