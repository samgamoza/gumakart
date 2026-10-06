import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isSafeUploadSegment,
  resolveWebPublicUploadsRoot,
  UPLOAD_MIME_BY_EXT,
} from "@/lib/local-uploads";
import { r2Get } from "@/lib/r2-uploads";

/** Phase 23: public review photos (same serve pattern as payment proofs). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const segments = (await context.params).path ?? [];
  if (segments.length === 0 || segments.length > 6 || !segments.every(isSafeUploadSegment)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Cloudflare Workers: objects live in R2 under the same path.
  const r2 = await r2Get(["reviews", ...segments].join("/"));
  if (r2) {
    const ext = (segments[segments.length - 1] ?? "").split(".").pop()?.toLowerCase() ?? "jpg";
    return new NextResponse(r2.body, {
      headers: {
        "Content-Type": r2.contentType ?? UPLOAD_MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const proofsRoot = path.join(resolveWebPublicUploadsRoot(), "reviews");
  const filePath = path.resolve(proofsRoot, ...segments);
  const rootResolved = path.resolve(proofsRoot) + path.sep;
  if (!filePath.startsWith(rootResolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const buffer = await readFile(filePath);
    const filename = segments[segments.length - 1] ?? "file.jpg";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": UPLOAD_MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
