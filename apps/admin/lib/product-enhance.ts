import { removeBackgroundToWhiteJpeg, removeProductBackground } from "./remove-background.server";

const OUTPUT_SIZE = 1024;
const PRODUCT_PADDING = 64;

/** True inside a Cloudflare Worker (admin.guma.one), where sharp and child processes don't exist. */
function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * Product photo → product on a clean white background, as JPEG.
 *
 * With REMOVE_BG_API_KEY (production, incl. Cloudflare Workers) remove.bg does
 * the whole job — cutout, white backdrop, crop with margin — so no native image
 * library is needed. Without a key, local dev uses the ONNX model + sharp and
 * composites a 1024×1024 square like before.
 */
export async function enhanceProductPhoto(inputBuffer: Buffer): Promise<Buffer> {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (apiKey) return removeBackgroundToWhiteJpeg(inputBuffer, apiKey);
  if (onWorkers() || process.env.VERCEL) {
    throw new Error("Photo enhance isn't set up yet (REMOVE_BG_API_KEY is missing). Upload the photo as-is for now.");
  }
  return enhanceLocally(inputBuffer);
}

async function enhanceLocally(inputBuffer: Buffer): Promise<Buffer> {
  // Loaded only in local dev; kept out of the Workers bundle.
  const sharpModule = "sharp";
  // sharp 0.35 types the module as a namespace with a callable default; older versions as the callable itself.
  const loaded = (await import(/* webpackIgnore: true */ sharpModule)) as { default?: unknown };
  const sharp = (loaded.default ?? loaded) as typeof import("sharp").default;

  const normalized = await sharp(inputBuffer).rotate().png().toBuffer();
  const cutout = await removeProductBackground(normalized);

  const cutoutMeta = await sharp(cutout).metadata();
  const width = cutoutMeta.width ?? OUTPUT_SIZE;
  const height = cutoutMeta.height ?? OUTPUT_SIZE;
  const maxProductSize = OUTPUT_SIZE - PRODUCT_PADDING * 2;
  const scale = Math.min(maxProductSize / width, maxProductSize / height, 1);
  const productWidth = Math.round(width * scale);
  const productHeight = Math.round(height * scale);

  const productLayer = await sharp(cutout)
    .resize(productWidth, productHeight, { fit: "inside" })
    .png()
    .toBuffer();

  const left = Math.round((OUTPUT_SIZE - productWidth) / 2);
  const top = Math.round((OUTPUT_SIZE - productHeight) / 2);

  return sharp({
    create: {
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: productLayer, left, top }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
