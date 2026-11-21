import type { ComfyWorkflow } from "../comfy-client";
import { GraphBuilder } from "./builder";

/**
 * Wan 2.1 image-to-video (480p model, vertical 480×832) using ComfyUI core nodes:
 * CLIPVision → WanImageToVideo → KSampler → VAEDecode → CreateVideo → SaveVideo.
 */
export interface WanModels {
  unet: string;
  textEncoder: string;
  vae: string;
  clipVision: string;
}

export const WAN_FPS = 16;
export const WAN_MAX_FRAMES = 81; // ≈5 s at 16 fps

/** Wan needs 4k+1 frames. */
export function wanFrames(seconds: number): number {
  const raw = Math.min(Math.round(seconds * WAN_FPS) + 1, WAN_MAX_FRAMES);
  return Math.max(17, Math.floor((raw - 1) / 4) * 4 + 1);
}

export function buildWanI2V(input: {
  image: string;
  prompt: string;
  negative?: string;
  seconds: number;
  seed: number;
  filenamePrefix: string;
  models: WanModels;
  width?: number;
  height?: number;
  steps?: number;
}): ComfyWorkflow {
  const g = new GraphBuilder();
  const m = input.models;
  const img = g.add("LoadImage", { image: input.image }, "Scene image");
  const cv = g.add("CLIPVisionLoader", { clip_name: m.clipVision });
  const cvEnc = g.add("CLIPVisionEncode", { clip_vision: g.out(cv), image: g.out(img), crop: "none" });
  const unet = g.add("UNETLoader", { unet_name: m.unet, weight_dtype: "default" }, "Wan 2.1 I2V");
  const sampling = g.add("ModelSamplingSD3", { model: g.out(unet), shift: 8 });
  const te = g.add("CLIPLoader", { clip_name: m.textEncoder, type: "wan", device: "default" });
  const pos = g.add("CLIPTextEncode", { text: input.prompt, clip: g.out(te) }, "Motion prompt");
  const neg = g.add("CLIPTextEncode", {
    text: input.negative ?? "blurry, distorted product, warped text, extra objects, flicker, low quality, watermark, deformed",
    clip: g.out(te),
  });
  const vae = g.add("VAELoader", { vae_name: m.vae });
  const i2v = g.add("WanImageToVideo", {
    positive: g.out(pos),
    negative: g.out(neg),
    vae: g.out(vae),
    clip_vision_output: g.out(cvEnc),
    start_image: g.out(img),
    width: input.width ?? 480,
    height: input.height ?? 832,
    length: wanFrames(input.seconds),
    batch_size: 1,
  });
  const ks = g.add("KSampler", {
    model: g.out(sampling),
    seed: input.seed,
    steps: input.steps ?? 20,
    cfg: 5,
    sampler_name: "uni_pc",
    scheduler: "simple",
    positive: g.out(i2v, 0),
    negative: g.out(i2v, 1),
    latent_image: g.out(i2v, 2),
    denoise: 1,
  });
  const dec = g.add("VAEDecode", { samples: g.out(ks), vae: g.out(vae) });
  const video = g.add("CreateVideo", { images: g.out(dec), fps: WAN_FPS });
  g.add("SaveVideo", { video: g.out(video), filename_prefix: input.filenamePrefix, format: "auto", codec: "auto" }, "Clip");
  return g.graph;
}
