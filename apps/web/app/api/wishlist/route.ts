import { NextResponse } from "next/server";
import { z } from "zod";
import { claimDeviceWishlist, DemandError, getTenantIdBySlug, isValidDeviceId, listWishlist, setWishlisted } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { currentBuyer } from "@/lib/guma-id";

const postSchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  productId: z.string().uuid(),
  saved: z.boolean(),
  deviceId: z.string().max(40).optional(),
});

async function ownerFor(deviceId: string | null | undefined) {
  const buyer = await currentBuyer().catch(() => null);
  if (buyer) return { buyerAccountId: buyer.id } as const;
  if (isValidDeviceId(deviceId)) return { deviceId } as const;
  return null;
}

/** Phase 22: save or unsave (Guma ID when signed in, else this device's anonymous id). */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`wishlist:${clientIpFrom(request)}`, { limit: 60, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Slow down a little." }, { status: 429 });
    const body = postSchema.parse(await request.json());
    const tenantId = await getTenantIdBySlug(body.tenantSlug);
    const owner = await ownerFor(body.deviceId);
    if (!tenantId || !owner) return NextResponse.json({ ok: false, error: "Not saved." }, { status: 400 });
    await setWishlisted(tenantId, body.productId, owner, body.saved);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the details." }, { status: 400 });
    if (error instanceof DemandError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    console.error("[wishlist POST]", error);
    return NextResponse.json({ ok: false, error: "Could not save." }, { status: 500 });
  }
}

/** Saved product ids at a shop for the signed-in buyer (or this device). */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const tenantId = await getTenantIdBySlug((q.get("tenantSlug") ?? "").slice(0, 64));
    const device = q.get("deviceId");
    const owner = await ownerFor(device);
    if (!tenantId || !owner) return NextResponse.json({ ok: true, productIds: [] });
    // Signed in on a device that saved items as a guest: move them onto the Guma ID.
    if ("buyerAccountId" in owner && device && isValidDeviceId(device)) await claimDeviceWishlist(String(device), String(owner.buyerAccountId)).catch(() => 0);
    return NextResponse.json({ ok: true, productIds: await listWishlist(tenantId, owner), signedIn: "buyerAccountId" in owner });
  } catch (error) {
    console.error("[wishlist GET]", error);
    return NextResponse.json({ ok: true, productIds: [] });
  }
}
