import { existsSync } from "node:fs";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { videoAdPayloadSchema, type VideoAdPayload } from "@gumakart/ai/studio";
import { isNodeFailure } from "../circuit-breaker";
import { assembleVideo, detectEncoder, probeDuration, thumbnail } from "../ffmpeg";
import { seedFrom } from "../graphs/builder";
import { buildF5Tts } from "../graphs/f5-tts";
import { buildWanI2V, wanFrames, WAN_FPS } from "../graphs/wan-i2v";
import { buildAss, kineticCues } from "../subtitles";
import { buildScriptMessages, parseScript, templateScript, type VideoScript } from "../video-script";
import { WorkflowInputError } from "../workflows";
import { cachedStep, extensionFor, readStep, runGraph, uploadToComfy } from "./runner";
import type { Pipeline, PipelineContext } from "./types";

const END_CARD_SEC = 3;

async function writeScript(ctx: PipelineContext, p: VideoAdPayload): Promise<VideoScript> {
  const name = await cachedStep(ctx, "script.json", async () => {
    let script: VideoScript | null = null;
    for (let attempt = 0; attempt < 2 && !script; attempt += 1) {
      const res = await ctx.llmBreaker.run(
        () => ctx.llm.chat({ messages: buildScriptMessages(p), maxTokens: 700, temperature: 0.8, responseFormat: { type: "json_object" } }, ctx.cfg.REALTIME_TIMEOUT_MS),
        isNodeFailure
      );
      script = parseScript(res.content, p);
      if (!script) ctx.log.warn("script JSON unusable — retrying", { attempt: attempt + 1 });
    }
    return new TextEncoder().encode(JSON.stringify(script ?? templateScript(p)));
  });
  return JSON.parse(new TextDecoder().decode(await readStep(ctx, name))) as VideoScript;
}

/** Preset voices live on the GPU node: <VOICE_PRESETS_DIR>/<style>.(wav|flac|mp3) + <style>.txt */
export async function presetVoice(dir: string, style: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string; text: string }> {
  for (const ext of ["wav", "flac", "mp3"]) {
    const audio = path.join(dir, `${style}.${ext}`);
    const transcript = path.join(dir, `${style}.txt`);
    if (existsSync(audio) && existsSync(transcript)) {
      const text = (await readFile(transcript, "utf8")).trim();
      if (text.length < 5) break;
      return {
        bytes: new Uint8Array(await readFile(audio)),
        filename: `${style}.${ext}`,
        contentType: ext === "mp3" ? "audio/mpeg" : `audio/${ext}`,
        text,
      };
    }
  }
  throw new WorkflowInputError(`voice preset "${style}" is not installed on the GPU node (add ${style}.wav and ${style}.txt to VOICE_PRESETS_DIR)`);
}

async function pickBgm(ctx: PipelineContext): Promise<string | undefined> {
  const dir = ctx.cfg.BGM_DIR;
  if (!dir || !existsSync(dir)) return undefined;
  const tracks = (await readdir(dir)).filter((f) => /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(f)).sort();
  if (!tracks.length) return undefined;
  const track = tracks[seedFrom(ctx.row.id) % tracks.length]!;
  const local = `bgm${path.extname(track).toLowerCase()}`;
  if (!existsSync(path.join(ctx.workDir, local))) await copyFile(path.join(dir, track), path.join(ctx.workDir, local));
  return local;
}

async function voiceover(ctx: PipelineContext, p: VideoAdPayload, script: VideoScript): Promise<string> {
  const speech = script.scenes.map((s) => s.line).join(" ");
  const existing = (await readdir(ctx.workDir).catch(() => [] as string[])).find((f) => f.startsWith("voice."));
  if (existing) return existing;
  let ref: { bytes: Uint8Array; filename: string; contentType: string; text: string };
  if (p.voiceStyle === "custom") {
    const sample = await ctx.fetcher.get(p.voiceSampleUrl!, "audio");
    ref = { ...sample, text: p.voiceSampleText! };
  } else {
    ref = await presetVoice(ctx.cfg.VOICE_PRESETS_DIR, p.voiceStyle);
  }
  const refName = await uploadToComfy(ctx, ref.bytes, `${ctx.row.id}-ref-${ref.filename}`, ref.contentType);
  const graph = buildF5Tts({
    referenceAudio: refName,
    referenceText: ref.text,
    speech,
    seed: seedFrom(`${ctx.row.id}:voice`),
    filenamePrefix: `gk_${ctx.row.id.slice(0, 8)}_voice`,
    nodeClass: ctx.cfg.COMFY_NODE_F5TTS,
  });
  ctx.log.info("rendering voiceover", { style: p.voiceStyle, words: speech.split(/\s+/).length });
  const out = (await runGraph(ctx, graph, `${ctx.row.id}:voice`)).find((r) => r.contentType.startsWith("audio/") || /\.(wav|flac|mp3|ogg)$/i.test(r.file.filename));
  if (!out) throw new WorkflowInputError("F5-TTS produced no audio");
  const name = `voice.${extensionFor(out.contentType, path.extname(out.file.filename).slice(1) || "flac")}`;
  await writeFile(path.join(ctx.workDir, name), out.bytes);
  return name;
}

async function sceneClip(ctx: PipelineContext, p: VideoAdPayload, script: VideoScript, i: number): Promise<string> {
  const name = `clip_${i}.mp4`;
  return cachedStep(ctx, name, async () => {
    const scene = script.scenes[i]!;
    const img = await ctx.fetcher.get(p.imageUrls[i % p.imageUrls.length]!, "image");
    const comfyName = await uploadToComfy(ctx, img.bytes, `${ctx.row.id}-scene${i}-${img.filename}`, img.contentType);
    const seconds = Math.min(scene.end - scene.start, (wanFrames(99) - 1) / WAN_FPS);
    const graph = buildWanI2V({
      image: comfyName,
      prompt: `${scene.visual}. Product advertisement, the product stays sharp and unchanged, smooth cinematic camera motion, vertical video, high quality`,
      seconds,
      seed: seedFrom(`${ctx.row.id}:clip${i}`),
      filenamePrefix: `gk_${ctx.row.id.slice(0, 8)}_clip${i}`,
      models: { unet: ctx.cfg.WAN_I2V_UNET, textEncoder: ctx.cfg.WAN_TEXT_ENCODER, vae: ctx.cfg.WAN_VAE, clipVision: ctx.cfg.WAN_CLIP_VISION },
    });
    ctx.log.info("rendering scene clip", { scene: i + 1, seconds });
    const out = (await runGraph(ctx, graph, `${ctx.row.id}:clip${i}`)).find((r) => r.contentType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(r.file.filename));
    if (!out) throw new WorkflowInputError(`Wan 2.1 produced no video for scene ${i + 1}`);
    return out.bytes;
  });
}

export const videoAdPipeline: Pipeline = async (ctx) => {
  const parsed = videoAdPayloadSchema.safeParse(ctx.row.inputPayload);
  if (!parsed.success) throw new WorkflowInputError(`invalid video ad request: ${parsed.error.issues[0]?.message}`);
  const p = parsed.data;
  const D = p.durationSec;
  const ff = ctx.cfg.FFMPEG_PATH;

  const script = await writeScript(ctx, p);
  await ctx.heartbeat();
  const voice = await voiceover(ctx, p, script);
  const clips: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    clips.push(await sceneClip(ctx, p, script, i));
    await ctx.heartbeat();
  }

  const qr = await cachedStep(ctx, "qr.png", async () => new Uint8Array(await QRCode.toBuffer(p.storeUrl, { width: 600, margin: 2, errorCorrectionLevel: "M" })));
  const voiceSeconds = await probeDuration(ff, voice, ctx.workDir);
  const clipSeconds = await Promise.all(clips.map((c) => probeDuration(ff, c, ctx.workDir)));

  // Subtitles follow the actual voice track (sped up to fit if needed — same rule as the mix).
  const room = D - 0.6;
  const atempo = voiceSeconds > room ? Math.min(voiceSeconds / room, 1.3) : 1;
  const spoken = Math.min(voiceSeconds / atempo, room);
  const totalChars = script.scenes.reduce((n, s) => n + s.line.length, 0) || 1;
  let t = 0.1;
  const lines = script.scenes.map((s) => {
    const dur = (spoken * s.line.length) / totalChars;
    const line = { start: t, end: t + dur, text: s.line };
    t += dur;
    return line;
  });
  const ass = buildAss({
    cues: kineticCues(lines),
    endCard: { start: D - END_CARD_SEC, end: D, lines: [p.shopName, "Order na po!", p.storeUrl.replace(/^https?:\/\//, "")] },
    font: ctx.cfg.SUBTITLE_FONT,
  });
  await writeFile(path.join(ctx.workDir, "subs.ass"), ass, "utf8");

  const encoder = await detectEncoder(ff, ctx.cfg.FFMPEG_ENCODER);
  const bgm = await pickBgm(ctx);
  const result = await assembleVideo(
    ff,
    ctx.workDir,
    {
      clips: clips.map((file, i) => ({ file, seconds: script.scenes[i]!.end - script.scenes[i]!.start, clipSeconds: clipSeconds[i]! })),
      voice,
      voiceSeconds,
      bgm,
      qrPng: qr,
      ass: "subs.ass",
      durationSec: D,
      endCardSec: END_CARD_SEC,
      output: "final.mp4",
    },
    encoder
  );
  await thumbnail(ff, ctx.workDir, "final.mp4", "thumbnail.jpg");
  ctx.log.info("video assembled", { encoder: result.encoder, atempo: result.atempo, script: script.source, bgm: !!bgm });

  const prefix = `gk_${ctx.row.id.slice(0, 8)}`;
  return [
    { bytes: await readStep(ctx, "final.mp4"), contentType: "video/mp4", filename: `${prefix}_ad_${D}s.mp4`, variant: "1080x1920" },
    { bytes: await readStep(ctx, "thumbnail.jpg"), contentType: "image/jpeg", filename: `${prefix}_thumbnail.jpg`, variant: "thumbnail" },
    { bytes: await readStep(ctx, "script.json"), contentType: "application/json", filename: `${prefix}_script.json`, variant: "script" },
  ];
};
