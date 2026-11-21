import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { r2Get, r2Put } from "./r2-uploads";

const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

function resolveImageMime(file: File): string | null {
  if (MIME_TO_EXT[file.type]) return file.type;
  // Some browsers leave type empty for AVIF — fall back to extension.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Where photos go, in order:
 *   1. Vercel Blob when BLOB_READ_WRITE_TOKEN is set (absolute URL),
 *   2. R2 on Cloudflare Workers (binding UPLOADS) — stored as products/<tenant>/<file>
 *      and addressed by the same relative /uploads/products/... URL the storefront serves,
 *   3. local disk under apps/web/public (dev only).
 */
function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobPathname(tenantId: string, filename: string): string {
  return `products/${tenantId}/${filename}`;
}

/** Resolve apps/web/public/uploads/products regardless of process.cwd() (admin vs turbo root). */
function resolveWebUploadsRoot(): string {
  const candidates = [
    path.join(process.cwd(), "apps/web/public/uploads/products"),
    path.join(process.cwd(), "../web/public/uploads/products"),
    path.join(process.cwd(), "../../apps/web/public/uploads/products"),
    path.join(__dirname, "../../../web/public/uploads/products"),
  ];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (existsSync(path.dirname(normalized))) {
      return normalized;
    }
  }
  return path.normalize(candidates[1]!);
}

export function getProductUploadDir(tenantId: string): string {
  return path.join(resolveWebUploadsRoot(), tenantId);
}

export function getProductUploadPublicUrl(tenantId: string, filename: string): string {
  return `/uploads/products/${tenantId}/${filename}`;
}

async function storeBuffer(
  tenantId: string,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<{ url: string; filename: string }> {
  if (blobEnabled()) {
    const blob = await put(blobPathname(tenantId, filename), buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return { url: blob.url, filename };
  }

  if (await r2Put(blobPathname(tenantId, filename), buffer, contentType)) {
    return { filename, url: getProductUploadPublicUrl(tenantId, filename) };
  }

  const dir = getProductUploadDir(tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
  return { filename, url: getProductUploadPublicUrl(tenantId, filename) };
}

export async function saveProductImage(
  tenantId: string,
  file: File
): Promise<{ url: string; filename: string }> {
  const mime = resolveImageMime(file);
  if (!mime || !MIME_TO_EXT[mime]) {
    throw new Error("Use a JPG, PNG, WebP, GIF, or AVIF image.");
  }

  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const ext = MIME_TO_EXT[mime]!;
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  return storeBuffer(tenantId, filename, buffer, mime);
}

/** Hosts our own uploads can live on (Vercel Blob). Nothing else is ever fetched (GK-12). */
function isOwnUploadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith(".public.blob.vercel-storage.com")) return true;
  const extra = (process.env.PRODUCT_UPLOAD_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return extra.includes(host);
}

function assertTenantOwnsImage(tenantId: string, imageUrl: string): void {
  if (imageUrl.startsWith("http")) {
    // Security G1 (GK-12): an absolute URL must be one of *our* uploads — https, on the
    // storage host we write to, under this shop's folder. "Path contains the tenant id"
    // alone let the server fetch any website (SSRF, quota burn).
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      throw new Error("Image must belong to your shop.");
    }
    if (url.protocol !== "https:" || !isOwnUploadHost(url.hostname) || !url.pathname.startsWith(`/products/${tenantId}/`) || url.pathname.includes("..")) {
      throw new Error("Image must belong to your shop.");
    }
    return;
  }
  if (!imageUrl.startsWith(`/uploads/products/${tenantId}/`)) {
    throw new Error("Image must belong to your shop.");
  }
}

export function resolveProductUploadPath(tenantId: string, relativeUrl: string): string {
  const prefix = `/uploads/products/${tenantId}/`;
  if (!relativeUrl.startsWith(prefix)) {
    throw new Error("Image must belong to your shop.");
  }
  const filename = relativeUrl.slice(prefix.length);
  if (!filename || filename.includes("..")) {
    throw new Error("Invalid image path.");
  }
  return path.join(getProductUploadDir(tenantId), filename);
}

export async function readProductImageBuffer(
  tenantId: string,
  imageUrl: string
): Promise<Buffer> {
  assertTenantOwnsImage(tenantId, imageUrl);

  if (imageUrl.startsWith("http")) {
    // No redirects (a redirect could leave the allow-listed host), a time limit, an image
    // content type and the same 5 MB ceiling as uploads.
    const res = await fetch(imageUrl, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("Could not load the original image.");
    const type = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!type.startsWith("image/")) throw new Error("Could not load the original image.");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error("Image must be 5 MB or smaller.");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error("Image must be 5 MB or smaller.");
    return buffer;
  }
  const stored = await readProductUpload(tenantId, imageUrl);
  if (!stored) throw new Error("Could not load the original image.");
  return stored.buffer;
}

/** Read a relative /uploads/products/<tenant>/<file> photo from R2, or disk off Workers. */
export async function readProductUpload(
  tenantId: string,
  relativeUrl: string
): Promise<{ buffer: Buffer; contentType?: string } | null> {
  const prefix = `/uploads/products/${tenantId}/`;
  const filename = relativeUrl.startsWith(prefix) ? relativeUrl.slice(prefix.length) : "";
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Image must belong to your shop.");
  }
  const object = await r2Get(blobPathname(tenantId, filename));
  if (object) return { buffer: Buffer.from(object.body), contentType: object.contentType };
  try {
    return { buffer: await readFile(resolveProductUploadPath(tenantId, relativeUrl)) };
  } catch {
    return null;
  }
}

export async function saveEnhancedProductImage(
  tenantId: string,
  buffer: Buffer
): Promise<{ url: string; filename: string }> {
  const filename = `${randomUUID()}-enhanced.jpg`;
  return storeBuffer(tenantId, filename, buffer, "image/jpeg");
}

// ─── AI Marketing Suite Phase 2: voice samples + media ownership ─────────────

const AUDIO_MIME_TO_EXT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

/**
 * Enterprise Vibe custom voice: the seller's ~10-second recording. Stored beside their product
 * photos (products/<tenant>/voice-<uuid>.<ext>) so the same storage, serving and ownership rules apply.
 */
export async function saveVoiceSample(tenantId: string, file: File): Promise<{ url: string; filename: string }> {
  const ext = AUDIO_MIME_TO_EXT[file.type] ?? ({ wav: "wav", mp3: "mp3", m4a: "m4a", ogg: "ogg", webm: "webm", flac: "flac" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!ext) throw new Error("Use a WAV, MP3, M4A, OGG, WebM or FLAC recording.");
  if (file.size > MAX_BYTES) throw new Error("Recording must be 5 MB or smaller.");
  if (file.size < 8 * 1024) throw new Error("That recording is too short — record about 10 seconds.");
  const contentType = file.type && AUDIO_MIME_TO_EXT[file.type] ? file.type : `audio/${ext === "m4a" ? "mp4" : ext === "mp3" ? "mpeg" : ext}`;
  return storeBuffer(tenantId, `voice-${randomUUID()}.${ext}`, Buffer.from(await file.arrayBuffer()), contentType);
}

/**
 * A media URL a seller hands to the Marketing Studio must be theirs: one of their uploads
 * (relative /uploads/products/<tenant>/… or our Blob host under products/<tenant>/), or one of
 * their own earlier AI outputs in the media bucket (<AI_MEDIA_PUBLIC_BASE_URL>/ai-media/<tenant>/…).
 * The GPU bridge enforces its own host allowlist on top of this.
 */
export function assertTenantOwnsMedia(tenantId: string, mediaUrl: string): void {
  const aiBase = (process.env.AI_MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (aiBase && mediaUrl.startsWith(`${aiBase}/ai-media/${tenantId}/`) && !mediaUrl.includes("..")) return;
  assertTenantOwnsImage(tenantId, mediaUrl);
}

/** AI suite Phase 4: a photo a buyer sent in chat for their review (bytes already downloaded from Meta). */
export async function saveReviewPhotoBytes(tenantId: string, bytes: Uint8Array): Promise<{ url: string; filename: string } | null> {
  if (bytes.byteLength > MAX_BYTES * 2 || bytes.byteLength < 100) return null;
  const b = bytes;
  const mime =
    b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      ? "image/jpeg"
      : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
        ? "image/png"
        : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
          ? "image/webp"
          : null;
  if (!mime) return null;
  const filename = `review-${randomUUID()}.${MIME_TO_EXT[mime]}`;
  return storeBuffer(tenantId, filename, Buffer.from(bytes), mime);
}
