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
