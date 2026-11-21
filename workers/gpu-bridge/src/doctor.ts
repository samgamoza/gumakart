/**
 * `pnpm --filter @gumakart/gpu-bridge doctor` — run on the GPU workstation after setup.
 * Verifies everything the Phase 2 pipelines need, against THIS machine's ComfyUI / vLLM / FFmpeg.
 */
import { existsSync } from "node:fs";
import { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { closeDb, getDb, MIGRATION_HEAD_TAG } from "./doctor-db";
import { ComfyClient } from "./comfy-client";
import { gpuNodeHeaders, loadConfig } from "./config";
import { run } from "./ffmpeg";
import { validateGraph, type ObjectInfo } from "./graph-validate";
import { buildF5Tts } from "./graphs/f5-tts";
import { buildFluxProductStudio } from "./graphs/flux-product-studio";
import { buildWanI2V } from "./graphs/wan-i2v";
import { createStorage } from "./index";
import { LlmClient } from "./llm-client";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
};

async function main() {
  const cfg = loadConfig();
  const headers = gpuNodeHeaders(cfg);
  const comfy = new ComfyClient({ baseUrl: cfg.COMFY_BASE_URL, headers });
  const llm = new LlmClient({ baseUrl: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, defaultModel: cfg.LLM_MODEL, headers });

  await check("ComfyUI reachable", async () => {
    const res = await fetch(`${cfg.COMFY_BASE_URL.replace(/\/$/, "")}/system_stats`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = (await res.json()) as { devices?: Array<{ name?: string; vram_total?: number }> };
    return (s.devices ?? []).map((d) => `${d.name} (${Math.round((d.vram_total ?? 0) / 1e9)} GB)`).join(", ") || "ok";
  });

  let info: ObjectInfo = {};
  await check("ComfyUI node catalog", async () => {
    const res = await fetch(`${cfg.COMFY_BASE_URL.replace(/\/$/, "")}/object_info`, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    info = (await res.json()) as ObjectInfo;
    return `${Object.keys(info).length} node types`;
  });

  const graphs = {
    "Product photo graph (Flux.1 Fill + RMBG-2.0)": buildFluxProductStudio({
      sourceImage: "example.png",
      sourceWidth: 1000,
      sourceHeight: 1000,
      prompt: "doctor",
      seed: 1,
      filenamePrefix: "doctor",
      aspects: [{ key: "1x1", width: 1080, height: 1080, genWidth: 1024, genHeight: 1024 }],
      models: { unet: cfg.FLUX_FILL_UNET, clipL: cfg.FLUX_CLIP_L, t5: cfg.FLUX_T5, vae: cfg.FLUX_VAE, rmbgModel: cfg.RMBG_MODEL, rmbgNode: cfg.COMFY_NODE_RMBG },
    }),
    "Video clip graph (Wan 2.1 I2V)": buildWanI2V({
      image: "example.png",
      prompt: "doctor",
      seconds: 4,
      seed: 1,
      filenamePrefix: "doctor",
      models: { unet: cfg.WAN_I2V_UNET, textEncoder: cfg.WAN_TEXT_ENCODER, vae: cfg.WAN_VAE, clipVision: cfg.WAN_CLIP_VISION },
    }),
    "Voice graph (F5-TTS)": buildF5Tts({ referenceAudio: "example.wav", referenceText: "doctor", speech: "doctor", seed: 1, filenamePrefix: "doctor", nodeClass: cfg.COMFY_NODE_F5TTS }),
  };
  for (const [name, graph] of Object.entries(graphs)) {
    await check(name, async () => {
      if (!Object.keys(info).length) throw new Error("skipped — node catalog unavailable");
      // "example.png"/"example.wav" are placeholders for uploaded files; don't flag them.
      const issues = validateGraph(graph, info).filter((i) => !/"(image|audio)" = "example\./.test(i.problem));
      if (issues.length) throw new Error(issues.map((i) => `${i.classType}: ${i.problem}`).join("; "));
      return "all nodes, inputs and model files present";
    });
  }

  await check("vLLM models", async () => {
    const res = await fetch(`${cfg.LLM_BASE_URL.replace(/\/$/, "")}/models`, {
      headers: { ...headers, ...(cfg.LLM_API_KEY ? { authorization: `Bearer ${cfg.LLM_API_KEY}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids = ((await res.json()) as { data?: Array<{ id: string }> }).data?.map((m) => m.id) ?? [];
    const missing = [cfg.LLM_MODEL, cfg.LLM_VISION_MODEL].filter((m) => !ids.includes(m));
    if (missing.length) throw new Error(`not served: ${missing.join(", ")} (serving: ${ids.join(", ") || "none"}) — set LLM_MODEL / LLM_VISION_MODEL`);
    return ids.join(", ");
  });
  await check("Qwen3 answers", async () => {
    const r = await llm.chat({ messages: [{ role: "user", content: "Sabihin ang 'ok' lang." }], maxTokens: 10 }, 30000);
    return `"${r.content.slice(0, 40)}" (${r.model})`;
  });

  await check("FFmpeg", async () => {
    const enc = await run(cfg.FFMPEG_PATH, ["-hide_banner", "-encoders"], process.cwd(), 20000);
    const fil = await run(cfg.FFMPEG_PATH, ["-hide_banner", "-filters"], process.cwd(), 20000);
    if (!/\bass\b/.test(fil.stdout)) throw new Error("this ffmpeg build has no libass (`ass` filter) — subtitles can't be burned in");
    if (!/\blibx264\b/.test(enc.stdout) && !/\bh264_nvenc\b/.test(enc.stdout)) throw new Error("no H.264 encoder (libx264 or h264_nvenc)");
    const probe = cfg.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, (_m, exe: string | undefined) => `ffprobe${exe ?? ""}`);
    await run(probe, ["-version"], process.cwd(), 20000);
    return /\bh264_nvenc\b/.test(enc.stdout) ? "h264_nvenc available (GPU encode), libass ok" : "libx264 (CPU encode), libass ok";
  });

  await check("Voice presets", async () => {
    const missing = ["energetic_filipina", "casual_kuya"].filter(
      (s) => !(["wav", "flac", "mp3"].some((e) => existsSync(`${cfg.VOICE_PRESETS_DIR}/${s}.${e}`)) && existsSync(`${cfg.VOICE_PRESETS_DIR}/${s}.txt`))
    );
    if (missing.length) throw new Error(`missing in ${cfg.VOICE_PRESETS_DIR}: ${missing.map((m) => `${m}.wav + ${m}.txt`).join(", ")}`);
    return cfg.VOICE_PRESETS_DIR;
  });

  await check("Media bucket write", async () => {
    const url = await createStorage(cfg).put(`ai-media/_doctor/${Date.now()}.txt`, new TextEncoder().encode("gpu-bridge doctor"), "text/plain");
    return url;
  });

  await check("Redis", async () => {
    const r = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await r.connect();
      return await r.ping();
    } finally {
      r.disconnect();
    }
  });

  await check("Database migrations", async () => {
    const rows = (await getDb().execute(sql`select count(*)::int as n from subscription_tiers`)) as unknown as Array<{ n: number }>;
    const rules = (await getDb().execute(
      sql`select count(*)::int as n from information_schema.columns where table_name = 'social_automation_rules' and column_name = 'content_queue_id'`
    )) as unknown as Array<{ n: number }>;
    if (!rules[0]?.n) throw new Error(`0048 not applied — run pnpm db:migrate (code expects ${MIGRATION_HEAD_TAG})`);
    return `${rows[0]?.n ?? 0} tiers, head ${MIGRATION_HEAD_TAG}`;
  });
  await closeDb();

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name.padEnd(width)}  ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed — see docs/ai-marketing-suite/gpu-node-setup.md` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
