import { NextResponse } from "next/server";
import { z } from "zod";
import { assignMissingBarcodes } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const schema = z.object({ variantIds: z.array(z.string().uuid()).max(2000).optional() });

/** Phase 24: give items without a barcode an in-store one, so labels can be printed and scanned at the POS. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json().catch(() => ({})));
    const assigned = await assignMissingBarcodes(session.tenantId, body.variantIds);
    if (assigned) {
      await recordActivity(session, { action: "inventory.barcodes", entityType: "inventory", entityId: null, summary: `Generated ${assigned} in-store barcode${assigned === 1 ? "" : "s"}` });
    }
    return NextResponse.json({ ok: true, assigned });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    console.error("[inventory/barcodes]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
