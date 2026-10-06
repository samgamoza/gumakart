/**
 * Phase 20 — shrink a photo in the browser before upload. Phone photos are often 3–8 MB; buyers
 * on mobile data shouldn't download that. Longest side ≤ `maxSide` (default 1600 px), WebP at
 * `quality` (JPEG where the browser can't make WebP), EXIF rotation applied. Returns the original
 * when it's already small, is a GIF (animation), can't be decoded (e.g. HEIC on some browsers),
 * or when shrinking wouldn't make it smaller. Never throws.
 */
export async function shrinkImage(file: File, opts: { maxSide?: number; quality?: number } = {}): Promise<File> {
  const maxSide = opts.maxSide ?? 1600;
  const quality = opts.quality ?? 0.82;
  try {
    if (typeof window === "undefined" || typeof createImageBitmap !== "function") return file;
    if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type)) return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 400 * 1024) {
      bitmap.close?.();
      return file;
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await toBlob("image/webp");
    if (!blob || blob.type !== "image/webp") {
      // No WebP encoder (older Safari). JPEG would drop transparency, so keep PNGs as they are.
      if (file.type === "image/png") return file;
      blob = await toBlob("image/jpeg");
    }
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const name = file.name.replace(/\.[^.]+$/, "") + "." + ext;
    return new File([blob], name, { type: blob.type, lastModified: Date.now() });
  } catch {
    return file;
  }
}
