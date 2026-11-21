import { ASPECT_RATIOS, productPhotoPayloadSchema, scenePrompt, type AspectRatio } from "@gumakart/ai/studio";
import { isNodeFailure } from "../circuit-breaker";
import { seedFrom } from "../graphs/builder";
import { buildFluxProductStudio } from "../graphs/flux-product-studio";
import { imageSize, SourceMediaError } from "../source-media";
import { WorkflowInputError } from "../workflows";
import { runGraph, uploadToComfy } from "./runner";
import type { Pipeline, PipelineContext } from "./types";

/** Qwen3-VL: one sentence on what the product is, its material, colour and lighting. */
export async function describeProduct(ctx: PipelineContext, bytes: Uint8Array, contentType: string, title?: string): Promise<string> {
  try {
    const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    const res = await ctx.llmBreaker.run(
      () =>
        ctx.llm.chat(
          {
            model: ctx.cfg.LLM_VISION_MODEL,
            maxTokens: 120,
            temperature: 0.2,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUrl } },
                  {
                    type: "text",
                    text:
                      "Describe ONLY the product in this photo for an image-generation prompt: what it is, material, colours, finish, and the direction/softness of the light on it. " +
                      "One sentence, under 35 words, no background, no marketing words." +
                      (title ? ` The seller calls it: "${title}".` : ""),
                  },
                ],
              },
            ],
          },
          ctx.cfg.REALTIME_TIMEOUT_MS
        ),
      isNodeFailure
    );
    const text = res.content.replace(/\s+/g, " ").trim();
    if (text.length >= 8) return text.slice(0, 300);
  } catch (error) {
    ctx.log.warn("product description failed — using the title", { error });
  }
  return title ? `a ${title}` : "the product";
}

export function photoPrompt(productDescription: string, scene: string): string {
  return (
    `${productDescription}, placed ${scene}. Professional product photography, photorealistic, ` +
    "natural soft contact shadow under the product, realistic reflections, correct perspective, sharp focus, high detail, commercial advertising photo"
  );
}

export const productPhotoPipeline: Pipeline = async (ctx) => {
  const parsed = productPhotoPayloadSchema.safeParse(ctx.row.inputPayload);
  if (!parsed.success) throw new WorkflowInputError(`invalid product photo request: ${parsed.error.issues[0]?.message}`);
  const p = parsed.data;

  const src = await ctx.fetcher.get(p.sourceImageUrl, "image");
  const size = imageSize(src.bytes);
  if (!size) throw new SourceMediaError("unsupported image format (use JPG, PNG or WebP)");
  if (size.width < 256 || size.height < 256) throw new SourceMediaError(`photo is too small (${size.width}×${size.height}); use at least 256 px`);

  await ctx.heartbeat();
  const comfyName = await uploadToComfy(ctx, src.bytes, `${ctx.row.id}-${src.filename}`, src.contentType);
  const description = await describeProduct(ctx, src.bytes, src.contentType, p.productTitle);

  const aspects = [...new Set(p.aspects)].map((key) => {
    const a = ASPECT_RATIOS[key as AspectRatio];
    return { key: key.replace(":", "x"), width: a.width, height: a.height, genWidth: a.genWidth, genHeight: a.genHeight };
  });
  const graph = buildFluxProductStudio({
    sourceImage: comfyName,
    sourceWidth: size.width,
    sourceHeight: size.height,
    prompt: photoPrompt(description, scenePrompt(p.scene, p.customPrompt)),
    seed: seedFrom(ctx.row.id),
    aspects,
    filenamePrefix: `gk_${ctx.row.id.slice(0, 8)}`,
    models: {
      unet: ctx.cfg.FLUX_FILL_UNET,
      clipL: ctx.cfg.FLUX_CLIP_L,
      t5: ctx.cfg.FLUX_T5,
      vae: ctx.cfg.FLUX_VAE,
      rmbgModel: ctx.cfg.RMBG_MODEL,
      rmbgNode: ctx.cfg.COMFY_NODE_RMBG,
    },
  });
  ctx.log.info("rendering product photo", { scene: p.scene, aspects: aspects.map((a) => a.key) });
  const results = await runGraph(ctx, graph, ctx.row.id);
  return results.map((r) => {
    const variant = aspects.find((a) => r.file.filename.includes(`_${a.key}`));
    return {
      bytes: r.bytes,
      contentType: r.contentType,
      filename: r.file.filename,
      variant: variant ? `${variant.width}x${variant.height}` : undefined,
    };
  });
};
