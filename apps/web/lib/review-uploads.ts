import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { r2Put } from "./r2-uploads";
import { resolveWebPublicUploadsRoot } from "./local-uploads";

/**
 * Phase 23: buyer review photos (shrunk in the browser first). Same storage order as payment
 * proofs: Vercel Blob → R2 (Workers) → local disk. Stored per shop and order so a review can only
 * carry photos uploaded from its own order link.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const safe = (v: string, d: string) => v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || d;

export function isReviewPhotoUrlForOrder(url: string, tenantSlug: string, orderNumber: string): boolean {
  const key = `reviews/${safe(tenantSlug, "shop")}/${safe(orderNumber, "order")}/`;
  if (url.startsWith(`/uploads/${key}`)) return !url.includes("..") && url.length < 300;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.startsWith(`/${key}`);
  } catch {
    return false;
  }
}

export async function saveReviewPhoto(input: { tenantSlug: string; orderNumber: string; file: File }): Promise<{ url: string }> {
  const mime = input.file.type || "";
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error("Use a JPG, PNG or WebP photo.");
  if (input.file.size > MAX_BYTES) throw new Error("Photo must be 4 MB or smaller.");
  const key = `reviews/${safe(input.tenantSlug, "shop")}/${safe(input.orderNumber, "order")}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await input.file.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(key, buffer, { access: "public", contentType: mime, addRandomSuffix: false });
    return { url: blob.url };
  }
  if (await r2Put(key, buffer, mime)) return { url: `/uploads/${key}` };

  const file = path.join(resolveWebPublicUploadsRoot(), key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return { url: `/uploads/${key}` };
}
