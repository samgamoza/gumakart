import { NextResponse } from "next/server";
import { z } from "zod";
import { linkMarketplaceListing } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/** Link a marketplace listing to a Guma variant (or unlink with null). */
export async function PATCH(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { listingId } = await params;
    z.string().uuid().parse(listingId);
    const { variantId } = z.object({ variantId: z.string().uuid().nullable() }).parse(await request.json());
    const ok = await linkMarketplaceListing(session.tenantId, listingId, variantId);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "marketplace link");
  }
}
