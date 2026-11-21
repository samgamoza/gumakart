/**
 * End-to-end: Postgres (0047/0048) + Redis + the real bridge (dispatcher, pipelines, FFmpeg, HTTP
 * endpoint) against a fake GPU node (ComfyUI + vLLM) that returns real PNG / FLAC / MP4 files.
 * Needs DATABASE_URL (local Postgres), REDIS_URL and ffmpeg/ffprobe on PATH. Run: pnpm test:e2e
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { bridgeCloserModel, callBridgeChat, mockCloserModel, runCloserTurn, runTaglishCopywriter, type CloserTools } from "@gumakart/ai";
import { aiMediaJobs, closeDb, enqueueAiMediaJob, getDb, getMerchantEntitlements, merchantEntitlements, tenants, type AiMediaOutput } from "@gumakart/db";
import { loadConfig } from "./config";
import { startBridge, type RunningBridge } from "./index";
import { createLogger } from "./logger";
import { RealtimeProducer } from "./producer";

const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";
if (!dbUrl || !redisUrl) throw new Error("e2e needs DATABASE_URL and REDIS_URL");
if (/neon\.tech|neon\.database|amazonaws|supabase/i.test(dbUrl)) throw new Error("Refusing to run against a hosted database.");

const SECRET = "e2e-secret-".repeat(4);
const state = { online: true, prompts: 0, failNext: false, graphs: [] as Array<Record<string, { class_type: string; inputs: Record<string, unknown> }>>, uploads: [] as string[], chats: [] as string[] };
let fixtures: { png: Buffer; flac: Buffer; mp4: Buffer; wav: Buffer };
let workDir = "";

function ffmpeg(args: string[], cwd: string) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { cwd });
}

/** Fake ComfyUI + vLLM on one port. */
function fakeGpuNode(): Server {
  const histories = new Map<string, unknown>();
  return createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!state.online) return json(530, { error: "Cloudflare tunnel offline" });
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (url.pathname === "/v1/models") return json(200, { data: [{ id: "qwen3-235b" }, { id: "qwen3-vl" }] });
      if (url.pathname === "/v1/chat/completions") {
        const body = JSON.parse(raw.toString());
        const sys = typeof body.messages[0].content === "string" ? body.messages[0].content : "";
        let content: string;
        if (Array.isArray(body.messages[0].content)) {
          state.chats.push("vision");
          content = "<think>look</think>a glossy red ceramic mug, soft light from the left";
        } else if (/video ad scripts/.test(sys)) {
          state.chats.push("script");
          content = JSON.stringify({
            scenes: [
              { role: "hook", start: 0, end: 4, line: "Uy, wait lang! Ito na ang mug na hinahanap mo!", visual: "fast push-in" },
              { role: "body", start: 4, end: 10, line: "₱249 na lang po, dati ₱299! Last 99 slots na lang!", visual: "slow orbit" },
              { role: "cta", start: 10, end: 15, line: "Order na sa link! COD at GCash available.", visual: "pull back" },
            ],
          });
        } else if (/24\/7 sales assistant/.test(sys)) {
          // Phase 3 closer: native tool calling (vLLM --enable-auto-tool-choice --tool-call-parser hermes).
          state.chats.push(`closer:${Array.isArray(body.tools) ? body.tools.length : 0}`);
          const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool");
          if (!toolMsgs.length) {
            return json(200, {
              model: body.model,
              choices: [{ message: { content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "check_product_inventory", arguments: JSON.stringify({ product_query: "ube pandesal" }) } }] }, finish_reason: "tool_calls" }],
              usage: { prompt_tokens: 50, completion_tokens: 10 },
            });
          }
          const replayed = body.messages.find((m: { role: string; tool_calls?: unknown[] }) => m.role === "assistant" && Array.isArray(m.tool_calls));
          content = replayed && /stock_left/.test(toolMsgs[0].content) ? "<think>ok</think>Available pa po! ₱240 per box, 7 pcs left 😊" : "Hmm?";
        } else if (/copywriter/.test(sys)) {
          state.chats.push("copy");
          content = JSON.stringify({ hooks: ["Mug goals!"], caption: "Red mug ₱249 lang!", hashtags: ["#mug"], commentKeyword: "MINE" });
        } else {
          state.chats.push("chat");
          content = `Sige po! ${body.messages.at(-1).content}`;
        }
        return json(200, { model: body.model, choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      }
      if (url.pathname === "/system_stats") return json(200, { devices: [] });
      if (url.pathname === "/upload/image") {
        const name = /filename="([^"]+)"/.exec(raw.toString("latin1"))?.[1] ?? "upload.bin";
        state.uploads.push(name);
        return json(200, { name, subfolder: "gumakart", type: "input" });
      }
      if (url.pathname === "/prompt") {
        const { prompt } = JSON.parse(raw.toString());
        state.graphs.push(prompt);
        state.prompts += 1;
        const id = `p-${state.prompts}`;
        const nodes = Object.values(prompt) as Array<{ class_type: string; inputs: Record<string, unknown> }>;
        const outputs: Record<string, Record<string, unknown[]>> = {};
        nodes.forEach((n, i) => {
          const pre = String(n.inputs.filename_prefix ?? "out");
          if (n.class_type === "SaveImage") outputs[String(i)] = { images: [{ filename: `${pre}_00001_.png`, subfolder: "", type: "output" }] };
          if (n.class_type === "SaveAudio") outputs[String(i)] = { audio: [{ filename: `${pre}_00001_.flac`, subfolder: "audio", type: "output" }] };
          if (n.class_type === "SaveVideo") outputs[String(i)] = { images: [{ filename: `${pre}_00001_.mp4`, subfolder: "video", type: "output" }], animated: [true] };
        });
        const fail = state.failNext;
        state.failNext = false;
        histories.set(id, fail ? { status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory" }]] } } : { status: { status_str: "success", completed: true }, outputs });
        return json(200, { prompt_id: id, number: state.prompts, node_errors: {} });
      }
      if (url.pathname.startsWith("/history/")) {
        const id = decodeURIComponent(url.pathname.slice(9));
        return json(200, histories.has(id) ? { [id]: histories.get(id) } : {});
      }
      if (url.pathname === "/view") {
        const f = url.searchParams.get("filename") ?? "";
        const [body, type] = f.endsWith(".png") ? [fixtures.png, "image/png"] : f.endsWith(".flac") ? [fixtures.flac, "audio/flac"] : [fixtures.mp4, "video/mp4"];
        res.writeHead(200, { "content-type": type });
        return res.end(body);
      }
      json(404, { error: "not found" });
    });
  });
}

/** The storefront serving seller uploads (the only host the bridge may fetch from). */
function fakeStorefront(): Server {
  return createServer((req, res) => {
    const p = req.url ?? "";
    if (p.endsWith(".png")) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(fixtures.png);
    }
    if (p.endsWith(".wav")) {
      res.writeHead(200, { "content-type": "audio/wav" });
      return res.end(fixtures.wav);
    }
    res.writeHead(404).end();
  });
}

const db = getDb();
const run = Math.random().toString(36).slice(2, 8);
const logLines: Array<{ msg: string; [k: string]: unknown }> = [];
let gpu: Server;
let shopSrv: Server;
let bridge: RunningBridge;
let shopBase = "";
let tenants_: Record<string, string> = {};

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}
const job = async (id: string) => (await db.select().from(aiMediaJobs).where(eq(aiMediaJobs.id, id)))[0]!;
const finished = (id: string, ms?: number) => waitFor(async () => { const j = await job(id); return j.status === "completed" || j.status === "failed" ? j : null; }, ms);

before(async () => {
  const fx = await mkdtemp(path.join(tmpdir(), "gk-e2e-fx-"));
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=800x800", "-frames:v", "1", "a.png"], fx);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=300:duration=9", "v.flac"], fx);
  ffmpeg(["-f", "lavfi", "-i", "testsrc=size=480x832:rate=16:duration=5", "-pix_fmt", "yuv420p", "c.mp4"], fx);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=200:duration=10", "s.wav"], fx);
  fixtures = { png: await readFile(path.join(fx, "a.png")), flac: await readFile(path.join(fx, "v.flac")), mp4: await readFile(path.join(fx, "c.mp4")), wav: await readFile(path.join(fx, "s.wav")) };
  const voices = await mkdtemp(path.join(tmpdir(), "gk-voices-"));
  await writeFile(path.join(voices, "energetic_filipina.wav"), fixtures.wav);
  await writeFile(path.join(voices, "energetic_filipina.txt"), "Hello po, ito ang reference recording.");
  workDir = await mkdtemp(path.join(tmpdir(), "gk-work-"));

  await new Redis(redisUrl).flushdb();
  gpu = fakeGpuNode();
  shopSrv = fakeStorefront();
  await new Promise<void>((r) => gpu.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => shopSrv.listen(0, "127.0.0.1", r));
  const gpuBase = `http://127.0.0.1:${(gpu.address() as AddressInfo).port}`;
  const shopPort = (shopSrv.address() as AddressInfo).port;
  shopBase = `http://127.0.0.1:${shopPort}`;
  const mediaDir = await mkdtemp(path.join(tmpdir(), "gk-e2e-out-"));

  for (const plan of ["pro_live", "enterprise_vibe", "starter"]) {
    const [t] = await db.insert(tenants).values({ slug: `e2e-${plan}-${run}`, name: `E2E ${plan}`, status: "active", subscriptionPlan: plan }).returning();
    tenants_[plan] = t!.id;
  }
  await db.update(aiMediaJobs).set({ dispatchedAt: new Date() }).where(eq(aiMediaJobs.status, "queued"));

  bridge = await startBridge(
    loadConfig({
      DATABASE_URL: dbUrl,
      REDIS_URL: redisUrl,
      LLM_BASE_URL: `${gpuBase}/v1`,
      COMFY_BASE_URL: gpuBase,
      MEDIA_STORAGE_DRIVER: "local",
      MEDIA_LOCAL_DIR: mediaDir,
      MEDIA_SOURCE_HOSTS: `127.0.0.1:${shopPort}`,
      MEDIA_SOURCE_BASE_URL: shopBase,
      MEDIA_SOURCE_ALLOW_HTTP: "true",
      WORK_DIR: workDir,
      VOICE_PRESETS_DIR: voices,
      FFMPEG_ENCODER: "libx264",
      SUBTITLE_FONT: "DejaVu Sans",
      GPU_BRIDGE_SECRET: SECRET,
      BRIDGE_HTTP_PORT: "0",
      DISPATCH_INTERVAL_MS: "250",
      HEALTH_INTERVAL_MS: "1000",
      COMFY_POLL_INTERVAL_MS: "250",
      BREAKER_FAILURE_THRESHOLD: "1",
      BREAKER_COOLDOWN_MS: "1000",
      OFFLINE_HOLD_MS: "1500",
      GPU_NODE_ID: "e2e-node",
    }),
    createLogger({}, (line) => logLines.push(JSON.parse(line)))
  );
});

after(async () => {
  await bridge?.stop();
  gpu?.close();
  shopSrv?.close();
  const ids = Object.values(tenants_);
  await db.delete(aiMediaJobs).where(inArray(aiMediaJobs.tenantId, ids)).catch(() => undefined);
  await db.delete(merchantEntitlements).where(inArray(merchantEntitlements.tenantId, ids)).catch(() => undefined);
  await closeDb();
});

const bridgeCfg = () => ({ url: `http://127.0.0.1:${bridge.httpPort()}`, secret: SECRET, timeoutMs: 5000 });

describe("Phase 2 pipelines e2e", () => {
  it("product photo: fetch → ComfyUI upload → Qwen3-VL description → Flux Fill graph → 2 sizes in the bucket", async () => {
    const t = tenants_.pro_live!;
    const r = await enqueueAiMediaJob({ tenantId: t, jobType: "product_photo", inputPayload: { sourceImageUrl: "/uploads/products/x/mug.png", scene: "tropical_boracay_beach", aspects: ["1:1", "9:16"], productTitle: "Red Mug" } });
    assert.ok(r.ok);
    const done = await finished(r.job.id);
    assert.equal(done.status, "completed", done.errorMessage ?? "");
    assert.equal(done.creditStatus, "consumed");
    assert.deepEqual(done.outputUrls.map((o: AiMediaOutput) => o.variant).sort(), ["1080x1080", "1080x1920"]);
    const graph = state.graphs.at(-1)!;
    const classes = Object.values(graph).map((n) => n.class_type);
    assert.ok(classes.includes("RMBG") && classes.includes("InpaintModelConditioning") && classes.includes("DifferentialDiffusion"));
    const prompt = Object.values(graph).find((n) => n.class_type === "CLIPTextEncode" && String(n.inputs.text).length > 10)!.inputs.text as string;
    assert.match(prompt, /^a glossy red ceramic mug, soft light from the left, placed on a smooth driftwood plank on a powdery white-sand Boracay beach/);
    assert.ok(!prompt.includes("<think>"));
    const load = Object.values(graph).find((n) => n.class_type === "LoadImage")!;
    assert.match(String(load.inputs.image), /^gumakart\/.*mug\.png$/);
    assert.ok(state.chats.includes("vision"));
  });

  it("video ad: Qwen3 script (claims scrubbed) → F5-TTS voice → 3 Wan clips → FFmpeg 15 s 1080×1920 with QR end card", async () => {
    const t = tenants_.pro_live!;
    const before = (await getMerchantEntitlements(t))!.videoCreditsUsedNow;
    const r = await enqueueAiMediaJob({
      tenantId: t,
      jobType: "video_ad",
      inputPayload: {
        imageUrls: ["/uploads/products/x/1.png", "/uploads/products/x/2.png"],
        productTitle: "Red Mug",
        price: 299,
        promoPrice: 249,
        voiceStyle: "energetic_filipina",
        durationSec: 15,
        shopName: "E2E Shop",
        storeUrl: "https://kart.guma.one/e2e-shop",
        paymentMethods: ["cod", "gcash"],
      },
    });
    assert.ok(r.ok);
    assert.equal((await getMerchantEntitlements(t))!.videoCreditsUsedNow, before + 1);
    const done = await finished(r.job.id, 90_000);
    assert.equal(done.status, "completed", done.errorMessage ?? "");
    const byVariant = Object.fromEntries(done.outputUrls.map((o: AiMediaOutput) => [o.variant, o]));
    assert.deepEqual(Object.keys(byVariant).sort(), ["1080x1920", "script", "thumbnail"]);
    const mp4 = new URL(byVariant["1080x1920"]!.url).pathname;
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", mp4]).toString();
    const info = JSON.parse(probe);
    assert.ok(Math.abs(Number(info.format.duration) - 15) < 0.3, `duration ${info.format.duration}`);
    assert.ok(info.streams.some((s: { codec_type: string; width?: number; height?: number }) => s.codec_type === "video" && s.width === 1080 && s.height === 1920));
    assert.ok(info.streams.some((s: { codec_type: string }) => s.codec_type === "audio"));
    const script = JSON.parse(await readFile(new URL(byVariant.script!.url), "utf8"));
    assert.equal(script.source, "llm");
    assert.ok(!/99 slots/.test(JSON.stringify(script)), "invented stock claim scrubbed");
    const ttsGraph = state.graphs.find((g) => Object.values(g).some((n) => n.class_type === "F5TTSAudioInputs"))!;
    const tts = Object.values(ttsGraph).find((n) => n.class_type === "F5TTSAudioInputs")!;
    assert.equal(tts.inputs.sample_text, "Hello po, ito ang reference recording.");
    assert.match(String(tts.inputs.speech), /Uy, wait lang!.*habang may stock pa.*COD at GCash/);
    const wanGraphs = state.graphs.filter((g) => Object.values(g).some((n) => n.class_type === "WanImageToVideo"));
    assert.equal(wanGraphs.length, 3, "one clip per scene");
    assert.ok(logLines.some((l) => l.msg === "video assembled" && l.encoder === "libx264"));
  });

  it("retry resumes from cached steps instead of re-rendering", async () => {
    // A finished job's work folder is cleaned up; simulate a crash after the voice step by
    // pre-seeding a work folder, then check only the remaining steps hit ComfyUI.
    const t = tenants_.pro_live!;
    const r = await enqueueAiMediaJob({
      tenantId: t,
      jobType: "video_ad",
      inputPayload: { imageUrls: ["/uploads/products/x/1.png"], productTitle: "Red Mug", price: 299, voiceStyle: "energetic_filipina", durationSec: 15, shopName: "E2E", storeUrl: "https://kart.guma.one/e2e", paymentMethods: ["cod"] },
    });
    assert.ok(r.ok);
    const dir = path.join(workDir, r.job.id);
    execFileSync("mkdir", ["-p", dir]);
    await writeFile(path.join(dir, "script.json"), JSON.stringify({ source: "template", scenes: [{ role: "hook", start: 0, end: 4, line: "Uy!", visual: "a" }, { role: "body", start: 4, end: 10, line: "₱299 lang po.", visual: "b" }, { role: "cta", start: 10, end: 15, line: "Order na!", visual: "c" }] }));
    await writeFile(path.join(dir, "voice.flac"), fixtures.flac);
    await writeFile(path.join(dir, "clip_0.mp4"), fixtures.mp4);
    const promptsBefore = state.prompts;
    const done = await finished(r.job.id, 90_000);
    assert.equal(done.status, "completed", done.errorMessage ?? "");
    assert.equal(state.prompts - promptsBefore, 2, "only clips 2 and 3 rendered");
    assert.ok(logLines.filter((l) => l.msg === "step cached — skipping").length >= 2);
  });

  it("missing voice preset / disallowed source host / ComfyUI error → failed with a clear message, credit refunded", async () => {
    const t = tenants_.pro_live!;
    const v = await enqueueAiMediaJob({ tenantId: t, jobType: "video_ad", inputPayload: { imageUrls: ["/uploads/products/x/1.png"], productTitle: "Mug", price: 100, voiceStyle: "casual_kuya", durationSec: 15, shopName: "S", storeUrl: "https://kart.guma.one/s", paymentMethods: ["cod"] } });
    const p = await enqueueAiMediaJob({ tenantId: t, jobType: "product_photo", inputPayload: { sourceImageUrl: "https://192.168.1.15/secret.png", scene: "minimalist_clean_studio", aspects: ["1:1"] } });
    assert.ok(v.ok && p.ok);
    const vd = await finished(v.job.id);
    assert.equal(vd.status, "failed");
    assert.match(vd.errorMessage ?? "", /voice preset "casual_kuya" is not installed/);
    assert.equal(vd.creditStatus, "refunded");
    const pd = await finished(p.job.id);
    assert.equal(pd.status, "failed");
    assert.match(pd.errorMessage ?? "", /not allowed|https/);
    assert.equal(pd.creditStatus, "refunded");
    state.failNext = true;
    const c = await enqueueAiMediaJob({ tenantId: t, jobType: "product_photo", inputPayload: { sourceImageUrl: "/uploads/products/x/m.png", scene: "minimalist_clean_studio", aspects: ["1:1"] } });
    assert.ok(c.ok);
    const cd = await finished(c.job.id);
    assert.match(cd.errorMessage ?? "", /KSampler: CUDA out of memory/);
    assert.equal(cd.creditStatus, "refunded");
  });

  it("tunnel offline: the job is held (not failed, credit kept), then renders once the node is back", async () => {
    const t = tenants_.pro_live!;
    state.online = false;
    const r = await enqueueAiMediaJob({ tenantId: t, jobType: "product_photo", inputPayload: { sourceImageUrl: "/uploads/products/x/hold.png", scene: "warm_cafe_wooden_table", aspects: ["1:1"] } });
    assert.ok(r.ok);
    await waitFor(async () => bridge.breakers.comfy.currentState !== "closed" || bridge.breakers.llm.currentState !== "closed");
    await new Promise((res) => setTimeout(res, 2500));
    let j = await job(r.job.id);
    assert.equal(j.status, "queued", "held, not failed");
    assert.equal(j.creditStatus, "reserved");
    state.online = true;
    j = await finished(r.job.id, 30_000);
    assert.equal(j.status, "completed", j.errorMessage ?? "");
    assert.equal(j.creditStatus, "consumed");
    assert.ok(logLines.some((l) => l.msg === "gpu node unavailable — job parked" || l.msg === "gpu node offline — holding media jobs in Postgres"));
  });

  it("voice clone (Enterprise Vibe): merchant sample → F5-TTS preview", async () => {
    const t = tenants_.enterprise_vibe!;
    const r = await enqueueAiMediaJob({ tenantId: t, jobType: "voice_clone", inputPayload: { sampleUrl: "/uploads/products/x/voice-1.wav", sampleText: "Hi po ako si Sam, salamat sa pagbili!" } });
    assert.ok(r.ok);
    const done = await finished(r.job.id);
    assert.equal(done.status, "completed", done.errorMessage ?? "");
    assert.deepEqual(done.outputUrls.map((o: AiMediaOutput) => [o.kind, o.variant]), [["audio", "preview"]]);
  });
});

describe("Phase 5 printair_mockup e2e", () => {
  it("real logo + QR flats (FFmpeg) → print PDF → Flux Fill mockups; priority 10, no credit", async () => {
    const t = tenants_.starter!;
    const r = await enqueueAiMediaJob({
      tenantId: t,
      jobType: "printair_mockup",
      inputPayload: { shopName: "Simply Sweet", storeUrl: "https://kart.guma.one/simply-sweet", logoUrl: `${shopBase}/uploads/logo.png`, brandColor: "#E11D48", tagline: "Baked with love", milestone: "orders_10" },
      idempotencyKey: `printair:e2e:${run}`,
    });
    assert.ok(r.ok);
    assert.deepEqual([r.job.priority, r.job.creditStatus], [10, "none"]);
    const done = await finished(r.job.id, 60_000);
    assert.equal(done.status, "completed", done.errorMessage ?? "");
    const variants = done.outputUrls.map((o: AiMediaOutput) => o.variant).sort();
    assert.deepEqual(variants, ["flat:mailer_box", "flat:parcel_sticker", "flat:thank_you_card", "mockup:mailer_box", "mockup:parcel_sticker", "mockup:thank_you_card", "print_pdf"]);
    const pdf = done.outputUrls.find((o: AiMediaOutput) => o.variant === "print_pdf")!;
    assert.equal(pdf.contentType, "application/pdf");
    const graph = state.graphs.at(-1)!;
    const nodes = Object.values(graph);
    assert.equal(nodes.filter((n) => n.class_type === "SaveImage").length, 3);
    assert.ok(!nodes.some((n) => n.class_type === "RMBG"), "the flat is protected whole — no background removal");
    const loads = nodes.filter((n) => n.class_type === "LoadImage").map((n) => String(n.inputs.image));
    assert.ok(loads.every((l) => /flat_(thank_you_card|parcel_sticker|mailer_box)\.png$/.test(l)), loads.join(","));
  });
});

describe("realtime HTTP endpoint e2e (D1)", () => {
  it("the app client signs, the bridge verifies and Qwen3 answers through gpu-realtime", async () => {
    const r = await callBridgeChat(bridgeCfg(), { tenantId: tenants_.starter!, purpose: "dm_closer", messages: [{ role: "user", content: "hm po?" }] });
    assert.equal(r.content, "Sige po! hm po?");
    assert.equal(r.model, "qwen3-235b");
    const health = await (await fetch(`${bridgeCfg().url}/healthz`)).json();
    assert.deepEqual(health, { ok: true, llm: "closed", comfy: "closed" });
    const bad = await fetch(`${bridgeCfg().url}/v1/realtime/chat`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    assert.equal(bad.status, 401);
  });

  it("AI closer (Phase 3): tool calls go through the signed endpoint and back; tool results feed the reply", async () => {
    const used: string[] = [];
    const tools: CloserTools = {
      check_product_inventory: async (a) => {
        used.push(`inv:${a.product_query}`);
        return { found: true, products: [{ product_id: "p1", title: "Ube Cheese Pandesal", variants: [{ variant_id: "v1", title: "Box of 12", price: 240, in_stock: true, stock_left: 7 }] }] };
      },
      quote_bayango_delivery: async () => ({ ok: false }),
      create_prefilled_checkout_link: async () => ({ ok: false }),
      escalate_to_human_seller: async () => ({ ok: true }),
    };
    const r = await runCloserTurn({
      ctx: { shopName: "E2E Bakery", paymentMethods: ["gcash", "cod"], buyerName: "Ana", platform: "messenger" },
      history: [{ direction: "in", body: "avail pa po ube pandesal?" }],
      tools,
      primary: bridgeCloserModel(bridgeCfg(), tenants_.starter!),
      fallback: () => mockCloserModel(),
    });
    assert.equal(r.servedBy, "gpu-node");
    assert.deepEqual(used, ["inv:ube pandesal"]);
    assert.equal(r.reply, "Available pa po! ₱240 per box, 7 pcs left 😊");
    assert.deepEqual(r.guards, []);
    assert.equal(r.tokens, 75, "60 (tool step) + 15 (reply)");
    assert.deepEqual(state.chats.filter((c) => c.startsWith("closer")), ["closer:4", "closer:4"], "all four tools offered on every step");
  });

  it("copywriter: GPU node first, cloud fallback the moment the tunnel drops", async () => {
    const input = { shopName: "E2E", productTitle: "Red Mug", price: 299, link: "https://kart.guma.one/e2e/products/mug", platform: "tiktok" as const };
    const local = await runTaglishCopywriter(input, { tenantId: tenants_.starter!, bridge: bridgeCfg() });
    assert.equal(local.servedBy, "gpu-node");
    assert.ok(local.output.caption.includes("https://kart.guma.one/e2e/products/mug"));

    state.online = false;
    const producer = new RealtimeProducer(new Redis(redisUrl, { maxRetriesPerRequest: null }));
    try {
      await assert.rejects(producer.chat({ kind: "chat", tenantId: tenants_.starter!, purpose: "other", request: { messages: [{ role: "user", content: "x" }] } }, 10_000), /GPU_NODE_UNAVAILABLE/);
      const reasons: string[] = [];
      const started = Date.now();
      const fallback = await runTaglishCopywriter(input, { tenantId: tenants_.starter!, bridge: bridgeCfg(), onFallback: (reason) => reasons.push(reason) });
      assert.notEqual(fallback.servedBy, "gpu-node");
      assert.deepEqual(reasons, ["unavailable"]);
      assert.ok(Date.now() - started < 3000, "breaker open → bridge answers 503 immediately");
    } finally {
      state.online = true;
      await producer.close();
    }
  });
});
