"use client";
import { isOptimizableImageSrc } from "./image-hosts";

/**
 * next/image loader (GK-11). Allow-listed sources go through `/_next/image` as before;
 * anything else is returned untouched so the browser loads it directly and our
 * optimiser never fetches a stranger's URL.
 */
export default function storefrontImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  if (!isOptimizableImageSrc(src)) return src;
  const params = new URLSearchParams({ url: src, w: String(width), q: String(quality ?? 75) });
  return `/_next/image?${params.toString()}`;
}
