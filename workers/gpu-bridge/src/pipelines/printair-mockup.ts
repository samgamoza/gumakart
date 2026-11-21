import { writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { printairMockupPayloadSchema } from "@gumakart/ai/studio";
import { run } from "../ffmpeg";
import { seedFrom } from "../graphs/builder";
import { buildPrintairMockup } from "../graphs/printair-mockup";
import { buildDesignAss, buildPrintPdf, designArgs, ITEM_SPECS, layoutFor, pixels, type PrintairItemId } from "../printair-design";
import { imageSize, sniffType } from "../source-media";
import { WorkflowInputError } from "../workflows";
import { cachedStep, readStep, runGraph, uploadToComfy } from "./runner";
import type { Pipeline, PipelineOutput } from "./types";

/**
 * printair_mockup (AI suite Phase 5): print-ready flats (thank-you card, parcel sticker, mailer box)
 * with the shop's real logo + QR → one print PDF → Flux.1 Fill mockup photos around each flat.
 * Low priority (10), no credit. Each step is cached so a retry resumes.
 */
export const printairMockupPipeline: Pipeline = async (ctx) => {
  const parsed = printairMockupPayloadSchema.safeParse(ctx.row.inputPayload);
  if (!parsed.success) throw new WorkflowInputError(`invalid printair mockup request: ${parsed.error.issues[0]?.message}`);
  const p = parsed.data;
  const ff = ctx.cfg.FFMPEG_PATH;
  const items = [...new Set(p.items)] as PrintairItemId[];

  // The logo is optional: a broken / missing logo makes a text-only design, never a failed job.
  let logo: string | null = null;
  if (p.logoUrl) {
    try {
      logo = await cachedStep(ctx, "logo.img", async () => {
        const src = await ctx.fetcher.get(p.logoUrl!, "image");
        if (!imageSize(src.bytes)) throw new Error("unsupported logo format");
        return src.bytes;
      });
    } catch (error) {
      ctx.log.warn("logo unavailable — text-only design", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const qr = await cachedStep(ctx, "qr.png", async () => new Uint8Array(await QRCode.toBuffer(p.storeUrl, { width: 900, margin: 2, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#FFFFFF" } })));

  const flats: Array<{ id: PrintairItemId; png: string; jpg: string; width: number; height: number }> = [];
  for (const id of items) {
    const layout = layoutFor(id, { color: p.brandColor, shopName: p.shopName, tagline: p.tagline, storeUrl: p.storeUrl, hasLogo: !!logo });
    const png = await cachedStep(ctx, `flat_${id}.png`, async () => {
      await writeFile(path.join(ctx.workDir, `flat_${id}.ass`), buildDesignAss(layout, ctx.cfg.SUBTITLE_FONT), "utf8");
      await run(ff, designArgs({ layout, logo, qr, ass: `flat_${id}.ass`, output: `flat_${id}.render.png` }), ctx.workDir, 120_000);
      return readStep(ctx, `flat_${id}.render.png`);
    });
    const jpg = await cachedStep(ctx, `flat_${id}.jpg`, async () => {
      await run(ff, ["-y", "-hide_banner", "-loglevel", "error", "-i", png, "-q:v", "2", "-pix_fmt", "yuvj444p", `flat_${id}.render.jpg`], ctx.workDir, 60_000);
      return readStep(ctx, `flat_${id}.render.jpg`);
    });
    flats.push({ id, png, jpg, ...pixels(ITEM_SPECS[id]) });
    await ctx.heartbeat();
  }

  const pdf = await cachedStep(ctx, "print.pdf", async () => {
    const pages = [];
    for (const f of flats) {
      const spec = ITEM_SPECS[f.id];
      pages.push({ jpeg: await readStep(ctx, f.jpg), widthPx: f.width, heightPx: f.height, widthIn: spec.widthIn, heightIn: spec.heightIn, title: f.id });
    }
    return buildPrintPdf(pages);
  });

  // Mockup photos on the GPU node.
  const uploaded = [];
  for (const f of flats) {
    const name = await uploadToComfy(ctx, await readStep(ctx, f.png), `${ctx.row.id}-flat_${f.id}.png`, "image/png");
    uploaded.push({ key: f.id, image: name, width: f.width, height: f.height, prompt: ITEM_SPECS[f.id].scenePrompt });
  }
  const prefix = `gk_${ctx.row.id.slice(0, 8)}`;
  const graph = buildPrintairMockup({
    items: uploaded,
    seed: seedFrom(ctx.row.id),
    filenamePrefix: prefix,
    models: { unet: ctx.cfg.FLUX_FILL_UNET, clipL: ctx.cfg.FLUX_CLIP_L, t5: ctx.cfg.FLUX_T5, vae: ctx.cfg.FLUX_VAE },
  });
  ctx.log.info("rendering packaging mockups", { items, logo: !!logo });
  const mockups = await runGraph(ctx, graph, `${ctx.row.id}:printair`);

  const out: PipelineOutput[] = [];
  for (const r of mockups) {
    const id = items.find((i) => r.file.filename.includes(`_mockup_${i}`));
    out.push({ bytes: r.bytes, contentType: r.contentType, filename: r.file.filename, variant: id ? `mockup:${id}` : "mockup" });
  }
  for (const f of flats) {
    const bytes = await readStep(ctx, f.png);
    out.push({ bytes, contentType: sniffType(bytes) ?? "image/png", filename: `${prefix}_flat_${f.id}.png`, variant: `flat:${f.id}` });
  }
  out.push({ bytes: await readStep(ctx, pdf), contentType: "application/pdf", filename: `${prefix}_print_ready.pdf`, variant: "print_pdf" });
  return out;
};
