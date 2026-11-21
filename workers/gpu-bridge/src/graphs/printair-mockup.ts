import type { ComfyWorkflow } from "../comfy-client";
import { GraphBuilder } from "./builder";
import { placeProduct, type FluxStudioModels } from "./flux-product-studio";

/**
 * printair_mockup — packaging mockup photos without touching the design (same idea as D4):
 * each print-ready flat is placed on the canvas, the WHOLE flat is protected, and Flux.1 Fill
 * paints only the scene around it (table, parcel, shadow). One branch per item, shared loaders.
 */
export interface PrintairMockupItem {
  key: string; // thank_you_card | parcel_sticker | mailer_box — in the output filename
  image: string; // ComfyUI input name of the flat
  width: number; // flat size in px
  height: number;
  prompt: string;
}

export function buildPrintairMockup(input: {
  items: PrintairMockupItem[];
  seed: number;
  filenamePrefix: string;
  models: Omit<FluxStudioModels, "rmbgModel" | "rmbgNode">;
  genSize?: number;
  exportSize?: number;
  steps?: number;
}): ComfyWorkflow {
  const g = new GraphBuilder();
  const m = input.models;
  const S = input.genSize ?? 1024;
  const E = input.exportSize ?? 1080;
  const unet = g.add("UNETLoader", { unet_name: m.unet, weight_dtype: "default" }, "Flux.1 Fill");
  const clip = g.add("DualCLIPLoader", { clip_name1: m.clipL, clip_name2: m.t5, type: "flux" });
  const vae = g.add("VAELoader", { vae_name: m.vae });
  const neg = g.add("CLIPTextEncode", { text: "", clip: g.out(clip) });
  const model = g.add("DifferentialDiffusion", { model: g.out(unet) });

  input.items.forEach((it, i) => {
    const p = placeProduct(it.width, it.height, S, S);
    const load = g.add("LoadImage", { image: it.image }, `Flat: ${it.key}`);
    const img = g.add("ImageScale", { image: g.out(load), upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" });
    const canvas = g.add("EmptyImage", { width: S, height: S, batch_size: 1, color: 0x808080 });
    const comp = g.add("ImageCompositeMasked", { destination: g.out(canvas), source: g.out(img), x: p.x, y: p.y, resize_source: false });
    const keep = g.add("SolidMask", { value: 1, width: p.width, height: p.height });
    const base = g.add("SolidMask", { value: 0, width: S, height: S });
    const placed = g.add("MaskComposite", { destination: g.out(base), source: g.out(keep), x: p.x, y: p.y, operation: "add" });
    const shrunk = g.add("GrowMask", { mask: g.out(placed), expand: -4, tapered_corners: false });
    const paint = g.add("InvertMask", { mask: g.out(shrunk) });
    const pos = g.add("CLIPTextEncode", { text: it.prompt, clip: g.out(clip) }, `Scene: ${it.key}`);
    const guided = g.add("FluxGuidance", { conditioning: g.out(pos), guidance: 30 });
    const cond = g.add("InpaintModelConditioning", { positive: g.out(guided), negative: g.out(neg), vae: g.out(vae), pixels: g.out(comp), mask: g.out(paint), noise_mask: false });
    const ks = g.add("KSampler", {
      model: g.out(model),
      seed: (input.seed + i * 7919) >>> 0,
      steps: input.steps ?? 28,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "normal",
      positive: g.out(cond, 0),
      negative: g.out(cond, 1),
      latent_image: g.out(cond, 2),
      denoise: 1,
    });
    const dec = g.add("VAEDecode", { samples: g.out(ks), vae: g.out(vae) });
    const fin = g.add("ImageScale", { image: g.out(dec), upscale_method: "lanczos", width: E, height: E, crop: "center" });
    g.add("SaveImage", { images: g.out(fin), filename_prefix: `${input.filenamePrefix}_mockup_${it.key}` }, `Export ${it.key}`);
  });
  return g.graph;
}
