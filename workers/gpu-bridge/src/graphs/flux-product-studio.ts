import type { ComfyWorkflow } from "../comfy-client";
import { GraphBuilder, roundTo } from "./builder";

/**
 * flux_product_studio — studio product photo without regenerating the product (decision D4):
 *
 *   LoadImage ─► RMBG-2.0 mask ─► scale product + mask ─► place on canvas
 *            ─► invert mask (background = area to paint) ─► Flux.1 Fill (InpaintModelConditioning,
 *               DifferentialDiffusion) paints the scene + contact shadow ─► VAEDecode ─► 1080 export
 *
 * One branch per requested aspect ratio; loaders and text encoders are shared.
 */
export interface FluxStudioModels {
  unet: string;
  clipL: string;
  t5: string;
  vae: string;
  rmbgModel: string;
  rmbgNode: string;
}

export interface FluxStudioAspect {
  key: string; // "1x1" | "9x16" — appears in the output filename
  width: number; // final export
  height: number;
  genWidth: number; // generation size (multiple of 16)
  genHeight: number;
}

export interface FluxStudioInput {
  sourceImage: string; // ComfyUI input name, e.g. "gumakart/abc.png"
  sourceWidth: number;
  sourceHeight: number;
  prompt: string;
  seed: number;
  aspects: FluxStudioAspect[];
  filenamePrefix: string;
  models: FluxStudioModels;
  steps?: number;
  guidance?: number;
}

/** Where the product sits on the canvas: centred, resting in the lower part, room for the scene. */
export function placeProduct(srcW: number, srcH: number, canvasW: number, canvasH: number): { width: number; height: number; x: number; y: number } {
  const portrait = canvasH > canvasW;
  const boxW = canvasW * (portrait ? 0.78 : 0.62);
  const boxH = canvasH * (portrait ? 0.46 : 0.62);
  const scale = Math.min(boxW / srcW, boxH / srcH, 3);
  const width = Math.min(roundTo(srcW * scale, 8), canvasW);
  const height = Math.min(roundTo(srcH * scale, 8), canvasH);
  const x = Math.round((canvasW - width) / 2);
  const bottom = canvasH * (portrait ? 0.8 : 0.88);
  const y = Math.max(Math.round(canvasH * 0.04), Math.round(bottom - height));
  return { width, height, x, y };
}

export function buildFluxProductStudio(input: FluxStudioInput): ComfyWorkflow {
  const g = new GraphBuilder();
  const m = input.models;

  const load = g.add("LoadImage", { image: input.sourceImage }, "Source product photo");
  const rmbg = g.add(
    m.rmbgNode,
    {
      image: g.out(load),
      model: m.rmbgModel,
      sensitivity: 1.0,
      process_res: 1024,
      mask_blur: 0,
      mask_offset: 0,
      invert_output: false,
      refine_foreground: false,
      background: "Alpha",
    },
    "RMBG-2.0 background removal"
  );
  const maskImg = g.add("MaskToImage", { mask: g.out(rmbg, 1) });

  const unet = g.add("UNETLoader", { unet_name: m.unet, weight_dtype: "default" }, "Flux.1 Fill");
  const clip = g.add("DualCLIPLoader", { clip_name1: m.clipL, clip_name2: m.t5, type: "flux" });
  const vae = g.add("VAELoader", { vae_name: m.vae });
  const pos = g.add("CLIPTextEncode", { text: input.prompt, clip: g.out(clip) }, "Scene prompt");
  const guided = g.add("FluxGuidance", { conditioning: g.out(pos), guidance: input.guidance ?? 30 });
  const neg = g.add("CLIPTextEncode", { text: "", clip: g.out(clip) });
  const model = g.add("DifferentialDiffusion", { model: g.out(unet) });

  for (const a of input.aspects) {
    const p = placeProduct(input.sourceWidth, input.sourceHeight, a.genWidth, a.genHeight);
    // Use LoadImage's RGB pixels (not RMBG's RGBA output) so channel counts match the canvas.
    const img = g.add("ImageScale", { image: g.out(load), upscale_method: "lanczos", width: p.width, height: p.height, crop: "disabled" });
    const mImg = g.add("ImageScale", { image: g.out(maskImg), upscale_method: "bilinear", width: p.width, height: p.height, crop: "disabled" });
    const mask = g.add("ImageToMask", { image: g.out(mImg), channel: "red" });
    const canvas = g.add("EmptyImage", { width: a.genWidth, height: a.genHeight, batch_size: 1, color: 0x808080 });
    const comp = g.add("ImageCompositeMasked", { destination: g.out(canvas), source: g.out(img), x: p.x, y: p.y, resize_source: false, mask: g.out(mask) });
    const solid = g.add("SolidMask", { value: 0, width: a.genWidth, height: a.genHeight });
    const placed = g.add("MaskComposite", { destination: g.out(solid), source: g.out(mask), x: p.x, y: p.y, operation: "add" });
    // Shrink the protected product area a few px so Flux blends the edge and paints the shadow.
    const shrunk = g.add("GrowMask", { mask: g.out(placed), expand: -6, tapered_corners: true });
    const paint = g.add("InvertMask", { mask: g.out(shrunk) });
    const cond = g.add("InpaintModelConditioning", {
      positive: g.out(guided),
      negative: g.out(neg),
      vae: g.out(vae),
      pixels: g.out(comp),
      mask: g.out(paint),
      noise_mask: false,
    });
    const ks = g.add("KSampler", {
      model: g.out(model),
      seed: input.seed,
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
    const fin = g.add("ImageScale", { image: g.out(dec), upscale_method: "lanczos", width: a.width, height: a.height, crop: "center" });
    g.add("SaveImage", { images: g.out(fin), filename_prefix: `${input.filenamePrefix}_${a.key}` }, `Export ${a.key}`);
  }
  return g.graph;
}
