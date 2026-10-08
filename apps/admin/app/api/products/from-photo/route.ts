import { NextResponse } from "next/server";
import { z } from "zod";
import { runPhotoListing, type PhotoListing } from "@gumakart/ai";
import { getTenantSettings } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAiForTenant } from "@/lib/ai-assist";
import { readProductImageBuffer } from "@/lib/product-uploads";

export const maxDuration = 60;

const schema = z.object({ imageUrl: z.string().min(1).max(2048), hint: z.string().max(200).optional() });
const MAX_BYTES = 6 * 1024 * 1024;

function sniffMime(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/**
 * Phase 33 (H2): the product photo the seller just uploaded → a draft title and description.
 * Uses one monthly AI generation. The form is filled for review; nothing is saved here.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const buffer = await readProductImageBuffer(session.tenantId, body.imageUrl);
    if (buffer.length > MAX_BYTES) return NextResponse.json({ ok: false, error: "That photo is too big to read (max 6 MB)." }, { status: 400 });
    const mimeType = sniffMime(buffer);
    if (!mimeType) return NextResponse.json({ ok: false, error: "Use a JPG, PNG or WebP photo." }, { status: 400 });

    const settings = await getTenantSettings(session.tenantId).catch(() => null);
    const result = await runAiForTenant<PhotoListing>(session.tenantId, {
      label: "from-photo",
      pool: "generation",
      run: () =>
        runPhotoListing({
          imageBase64: buffer.toString("base64"),
          mimeType,
          shopName: session.tenantName,
          shopCategory: settings?.category ?? null,
          hint: body.hint,
        }),
    });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, listing: result.output });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    console.error("[products/from-photo]", error);
    return NextResponse.json({ ok: false, error: "Could not read the photo. Try another image." }, { status: 500 });
  }
}
