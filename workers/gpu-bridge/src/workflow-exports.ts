import type { ComfyWorkflow } from "./comfy-client";
import { buildF5Tts } from "./graphs/f5-tts";
import { buildFluxProductStudio } from "./graphs/flux-product-studio";
import { buildPrintairMockup } from "./graphs/printair-mockup";
import { buildWanI2V } from "./graphs/wan-i2v";

/**
 * Reference graphs written to workflows/comfyui/*.json — load them in ComfyUI ("Load (API format)")
 * to inspect or tweak the pipelines. Placeholders: example.png / example.wav, default model names.
 * `pnpm --filter @gumakart/gpu-bridge export-workflows` regenerates them; a test keeps them in sync.
 */
export function referenceWorkflows(): Record<string, ComfyWorkflow> {
  return {
    "flux_product_studio.json": buildFluxProductStudio({
      sourceImage: "example.png",
      sourceWidth: 1200,
      sourceHeight: 1200,
      prompt: "a matte black stainless steel tumbler, soft light from the left, placed in a minimalist photo studio, seamless off-white backdrop. Professional product photography, photorealistic, natural soft contact shadow under the product",
      seed: 42,
      filenamePrefix: "gk_example",
      aspects: [
        { key: "1x1", width: 1080, height: 1080, genWidth: 1024, genHeight: 1024 },
        { key: "9x16", width: 1080, height: 1920, genWidth: 768, genHeight: 1344 },
      ],
      models: { unet: "flux1-fill-dev.safetensors", clipL: "clip_l.safetensors", t5: "t5xxl_fp8_e4m3fn.safetensors", vae: "ae.safetensors", rmbgModel: "RMBG-2.0", rmbgNode: "RMBG" },
    }),
    "wan21_i2v_scene.json": buildWanI2V({
      image: "example.png",
      prompt: "slow push-in, soft sunlight sweeping across the product. Product advertisement, smooth cinematic camera motion",
      seconds: 5,
      seed: 42,
      filenamePrefix: "gk_example_clip",
      models: { unet: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", textEncoder: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", vae: "wan_2.1_vae.safetensors", clipVision: "clip_vision_h.safetensors" },
    }),
    "printair_mockup.json": buildPrintairMockup({
      items: [
        { key: "thank_you_card", image: "example_flat_thank_you_card.png", width: 1200, height: 1800, prompt: "a printed thank-you card lying on a light wooden table beside a kraft paper parcel, soft natural window light, top-down flat lay product photography" },
        { key: "mailer_box", image: "example_flat_mailer_box.png", width: 2400, height: 1800, prompt: "the printed front panel of a corrugated mailer box on a clean white desk, soft studio light, product photography" },
      ],
      seed: 42,
      filenamePrefix: "gk_example",
      models: { unet: "flux1-fill-dev.safetensors", clipL: "clip_l.safetensors", t5: "t5xxl_fp8_e4m3fn.safetensors", vae: "ae.safetensors" },
    }),
    "f5_tts_voiceover.json": buildF5Tts({
      referenceAudio: "example.wav",
      referenceText: "Hello po, ito ang reference recording ko.",
      speech: "Uy, wait lang! Ito na ang tumbler na hinahanap mo!",
      seed: 42,
      filenamePrefix: "gk_example_voice",
      nodeClass: "F5TTSAudioInputs",
    }),
  };
}

const isEntry = process.argv[1]?.endsWith("workflow-exports.ts");
if (isEntry) {
  const { writeFileSync } = await import("node:fs");
  for (const [name, graph] of Object.entries(referenceWorkflows())) {
    writeFileSync(new URL(`../workflows/comfyui/${name}`, import.meta.url), JSON.stringify(graph, null, 2) + "\n");
    console.log("wrote", name);
  }
}
