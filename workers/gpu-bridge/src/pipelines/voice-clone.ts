import { voiceClonePayloadSchema } from "@gumakart/ai/studio";
import { seedFrom } from "../graphs/builder";
import { buildF5Tts } from "../graphs/f5-tts";
import { WorkflowInputError } from "../workflows";
import { runGraph, uploadToComfy } from "./runner";
import type { Pipeline } from "./types";

export const DEFAULT_PREVIEW_TEXT = "Hi po! Ito na ang boses ko para sa mga video ads ng shop natin. Order na po kayo, salamat!";

/**
 * Enterprise Vibe "Custom Cloned Voice": render a short preview in the merchant's voice so they can
 * approve it before using it in video ads. The sample itself stays where the merchant uploaded it.
 */
export const voiceClonePipeline: Pipeline = async (ctx) => {
  const parsed = voiceClonePayloadSchema.safeParse(ctx.row.inputPayload);
  if (!parsed.success) throw new WorkflowInputError(`invalid voice clone request: ${parsed.error.issues[0]?.message}`);
  const p = parsed.data;
  const sample = await ctx.fetcher.get(p.sampleUrl, "audio");
  const ref = await uploadToComfy(ctx, sample.bytes, `${ctx.row.id}-sample-${sample.filename}`, sample.contentType);
  const graph = buildF5Tts({
    referenceAudio: ref,
    referenceText: p.sampleText,
    speech: p.previewText ?? DEFAULT_PREVIEW_TEXT,
    seed: seedFrom(ctx.row.id),
    filenamePrefix: `gk_${ctx.row.id.slice(0, 8)}_voice_preview`,
    nodeClass: ctx.cfg.COMFY_NODE_F5TTS,
  });
  const out = (await runGraph(ctx, graph, ctx.row.id)).filter((r) => r.contentType.startsWith("audio/") || /\.(wav|flac|mp3|ogg)$/i.test(r.file.filename));
  if (!out.length) throw new WorkflowInputError("F5-TTS produced no audio");
  return out.map((r) => ({ bytes: r.bytes, contentType: r.contentType, filename: r.file.filename, variant: "preview" }));
};
