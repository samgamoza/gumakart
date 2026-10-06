import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isSafeUploadSegment,
  resolveWebPublicUploadsRoot,
  UPLOAD_MIME_BY_EXT,
} from "@/lib/local-uploads";
import { r2Get } from "@/lib/r2-uploads";
import { ALL_IMAGE_WIDTHS } from "@/lib/image-sizes";

/**
 * Phase 20: ?w=<width> returns a resized WebP via the Cloudflare Images binding (IMAGES),
 * cached at the edge. Without the binding (local dev) or for GIFs the original is returned.
 */
async function resized(request: Request, body: ArrayBuffer, contentType: string, width: number): Promise<Response | null> {
  if (contentType === "image/gif") return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as { IMAGES?: { input(s: ReadableStream): { transform(o: object): { output(o: object): Promise<{ response(): Response }> } } } };
    if (!env.IMAGES) return null;
    const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
    const key = new Request(request.url, { method: "GET" });
    const hit = cache ? await cache.match(key) : undefined;
    if (hit) return hit;
    const out = await env.IMAGES.input(new Blob([body]).stream())
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: 75 });
    const res = out.response();
    const response = new Response(res.body, {
      headers: {
        "Content-Type": "image/webp",
        // Upload names are random — a URL never changes content.
        "Cache-Control": "public, max-age=31536000, immutable",
        Vary: "Accept",
      },
    });
    if (cache) await cache.put(key, response.clone()).catch(() => null);
    return response;
  } catch (error) {
    console.error("[uploads] resize failed, serving original", error);
    return null;
  }
}

/**
 * Serve seller product images from local disk at request time.
 *
 * Why this exists: with a root `[tenantSlug]` route, newly uploaded files under
 * `public/uploads/...` can miss Next's static file map and get a cached App Router
 * 404 until process restart. A dedicated route always reads the filesystem.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ tenantId: string; filename: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { tenantId, filename } = await context.params;

  if (!isSafeUploadSegment(tenantId) || !isSafeUploadSegment(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Cloudflare Workers: objects live in R2 under the same path.
  const r2 = await r2Get(`products/${tenantId}/${filename}`);
  if (r2) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
    const type = r2.contentType ?? UPLOAD_MIME_BY_EXT[ext] ?? "application/octet-stream";
    const w = Number(new URL(request.url).searchParams.get("w"));
    if (ALL_IMAGE_WIDTHS.includes(w)) {
      const small = await resized(request, r2.body, type, w);
      if (small) return small;
    }
    return new NextResponse(r2.body, {
      headers: {
        "Content-Type": r2.contentType ?? UPLOAD_MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  }

  const productsRoot = path.join(resolveWebPublicUploadsRoot(), "products");
  const filePath = path.resolve(productsRoot, tenantId, filename);
  const rootResolved = path.resolve(productsRoot) + path.sep;
  if (!filePath.startsWith(rootResolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const buffer = await readFile(filePath);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": UPLOAD_MIME_BY_EXT[ext] ?? "application/octet-stream",
        // UUIDs in filenames — safe to cache; new uploads get new URLs.
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
