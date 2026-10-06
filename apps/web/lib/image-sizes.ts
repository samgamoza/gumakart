/**
 * Phase 20 — one list of image widths for the whole buyer site. Kept short on purpose: every
 * (photo × width) is one Cloudflare "unique transformation" (5,000/month free), so fewer widths
 * means the free tier lasts longer. next.config.ts uses the same numbers.
 */
export const IMAGE_SIZES = [64, 128, 256] as const;
export const DEVICE_SIZES = [384, 640, 828, 1200] as const;
export const ALL_IMAGE_WIDTHS: readonly number[] = [...IMAGE_SIZES, ...DEVICE_SIZES];

/** The smallest allowed width that covers `px` CSS pixels at `dpr` (default 2 — most phones). */
export function snapWidth(px: number, dpr = 2): number {
  const need = Math.ceil(px * dpr);
  return ALL_IMAGE_WIDTHS.find((w) => w >= need) ?? ALL_IMAGE_WIDTHS[ALL_IMAGE_WIDTHS.length - 1]!;
}

const isSellerUpload = (src: string) => /^\/uploads\/products\/[^/?#]+\/[^/?#]+$/.test(src);

/**
 * A resized URL for an image shown about `px` CSS pixels wide.
 *  - seller uploads (R2): our own route resizes with ?w= (Cloudflare Images binding)
 *  - other site images and https photos: Next's optimizer
 *  - data:/blob: and SVGs: unchanged
 */
export function sizedImageUrl(src: string | null | undefined, px: number): string {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("blob:") || /\.svg($|\?)/i.test(src)) return src;
  const w = snapWidth(px);
  if (isSellerUpload(src)) return `${src}?w=${w}`;
  if (src.startsWith("/") || /^https?:\/\//.test(src)) return `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;
  return src;
}

/** srcset for a seller upload / site image across the widths that matter for `maxPx`. */
export function sizedSrcSet(src: string | null | undefined, maxPx: number): string | undefined {
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || /\.svg($|\?)/i.test(src)) return undefined;
  const top = snapWidth(maxPx);
  const widths = ALL_IMAGE_WIDTHS.filter((w) => w >= 128 && w <= top);
  if (widths.length === 0) return undefined;
  return widths.map((w) => `${sizedImageUrl(src, w / 2)} ${w}w`).join(", ");
}
