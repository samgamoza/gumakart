import { z } from "zod";

/**
 * gpu-bridge configuration. Runs on any Node 20+ host with Redis — typically the home GPU
 * workstation itself (so ComfyUI/vLLM are on localhost) or a small VPS that reaches the node
 * through the Cloudflare Tunnel hostnames.
 */
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (direct or pooled Postgres URL)"),
  REDIS_URL: z.string().url("REDIS_URL must be a redis:// or rediss:// URL"),

  LLM_BASE_URL: z.string().url().default("https://llm-node.guma.one/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("qwen3-235b"),
  COMFY_BASE_URL: z.string().url().default("https://gpu-node.guma.one"),
  /** Cloudflare Access service token, if the tunnel hostnames are behind Access. */
  CF_ACCESS_CLIENT_ID: z.string().optional(),
  CF_ACCESS_CLIENT_SECRET: z.string().optional(),
  GPU_NODE_ID: z.string().default("home-gpu-1"),

  /** s3 = Cloudflare R2 / MinIO / any S3-compatible bucket; local = filesystem (dev only). */
  MEDIA_STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_REGION: z.string().default("auto"),
  MEDIA_S3_BUCKET: z.string().optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public base URL the bucket is served from, e.g. https://media.guma.one */
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
  MEDIA_LOCAL_DIR: z.string().default("./.media-out"),

  REALTIME_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  REALTIME_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
  /** One GPU renders one graph at a time; raise only with multiple GPUs / ComfyUI instances. */
  BATCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  BATCH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  COMFY_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2_000),
  COMFY_JOB_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(20 * 60_000),

  BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1000).default(30_000),
  /** How long a job is parked when the GPU node is offline before it's looked at again. */
  OFFLINE_HOLD_MS: z.coerce.number().int().min(1000).default(60_000),
  DISPATCH_INTERVAL_MS: z.coerce.number().int().min(250).default(3_000),
  HEALTH_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  /** processing rows untouched this long are failed + refunded (worker died mid-render). */
  STUCK_JOB_MS: z.coerce.number().int().min(60_000).default(45 * 60_000),

  ENABLE_REALTIME: bool.default("true"),
  ENABLE_BATCH: bool.default("true"),

  // ─── Phase 2: realtime HTTP endpoint (D1) ───
  ENABLE_HTTP: bool.default("true"),
  /** Bind to localhost; cloudflared publishes it as e.g. https://bridge.guma.one */
  BRIDGE_HTTP_HOST: z.string().default("127.0.0.1"),
  BRIDGE_HTTP_PORT: z.coerce.number().int().min(0).max(65535).default(8790),
  /** Shared HMAC secret — same value as GPU_BRIDGE_SECRET in the apps. ≥ 32 chars. */
  GPU_BRIDGE_SECRET: z.string().optional(),
  /** How long the endpoint waits for a realtime completion before answering 504. */
  HTTP_REALTIME_WAIT_MS: z.coerce.number().int().min(1000).default(30_000),

  // ─── Phase 2: media pipelines ───
  /** Hosts the bridge may download source media from (SSRF guard). `*.` prefix = subdomains. */
  MEDIA_SOURCE_HOSTS: z.string().default("kart.guma.one,media.guma.one,*.public.blob.vercel-storage.com"),
  /** Base for relative upload paths like /uploads/products/... (the storefront serves them). */
  MEDIA_SOURCE_BASE_URL: z.string().url().default("https://kart.guma.one"),
  /** Tests only — production fetches source media over https. */
  MEDIA_SOURCE_ALLOW_HTTP: bool.default("false"),
  MEDIA_MAX_SOURCE_BYTES: z.coerce.number().int().min(1024).default(15 * 1024 * 1024),
  WORK_DIR: z.string().default("./.work"),
  LLM_VISION_MODEL: z.string().default("qwen3-vl"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  /** auto = h264_nvenc when the GPU encoder is available, else libx264. */
  FFMPEG_ENCODER: z.enum(["auto", "h264_nvenc", "libx264"]).default("auto"),
  /** <style>.wav + <style>.txt (exact transcript) reference voices for F5-TTS. */
  VOICE_PRESETS_DIR: z.string().default("./voices"),
  /** Optional folder of royalty-free background beds (.mp3/.wav/.m4a). Empty = voice only. */
  BGM_DIR: z.string().optional(),
  SUBTITLE_FONT: z.string().default("Montserrat ExtraBold"),
  // Model file names as installed in ComfyUI/models/*
  FLUX_FILL_UNET: z.string().default("flux1-fill-dev.safetensors"),
  FLUX_CLIP_L: z.string().default("clip_l.safetensors"),
  FLUX_T5: z.string().default("t5xxl_fp8_e4m3fn.safetensors"),
  FLUX_VAE: z.string().default("ae.safetensors"),
  RMBG_MODEL: z.string().default("RMBG-2.0"),
  WAN_I2V_UNET: z.string().default("wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors"),
  WAN_TEXT_ENCODER: z.string().default("umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
  WAN_VAE: z.string().default("wan_2.1_vae.safetensors"),
  WAN_CLIP_VISION: z.string().default("clip_vision_h.safetensors"),
  // Custom-node class names (override if your node pack names them differently)
  COMFY_NODE_RMBG: z.string().default("RMBG"),
  COMFY_NODE_F5TTS: z.string().default("F5TTSAudioInputs"),
});

export type BridgeConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`gpu-bridge: invalid configuration\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.ENABLE_BATCH && cfg.MEDIA_STORAGE_DRIVER === "s3") {
    const missing = (
      ["MEDIA_S3_ENDPOINT", "MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY", "MEDIA_PUBLIC_BASE_URL"] as const
    ).filter((k) => !cfg[k]);
    if (missing.length) {
      throw new Error(`gpu-bridge: MEDIA_STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
    }
  }
  if (cfg.ENABLE_HTTP && (!cfg.GPU_BRIDGE_SECRET || cfg.GPU_BRIDGE_SECRET.length < 32)) {
    throw new Error("gpu-bridge: ENABLE_HTTP=true needs GPU_BRIDGE_SECRET (at least 32 characters; generate with `openssl rand -hex 32`)");
  }
  return cfg;
}

/** Headers for requests through the Cloudflare Tunnel (Access service token, if configured). */
export function gpuNodeHeaders(cfg: Pick<BridgeConfig, "CF_ACCESS_CLIENT_ID" | "CF_ACCESS_CLIENT_SECRET">): Record<string, string> {
  if (!cfg.CF_ACCESS_CLIENT_ID || !cfg.CF_ACCESS_CLIENT_SECRET) return {};
  return { "CF-Access-Client-Id": cfg.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": cfg.CF_ACCESS_CLIENT_SECRET };
}
