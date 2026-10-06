import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, sessionCookieHeader } from "@gumakart/auth";
import { touchPartnerOpen, verifyPartnerAccess } from "@gumakart/db";
import { homeFor } from "@gumakart/db/staff-permissions";
import { requirePartner } from "@/lib/partner-auth";
import { partnerFail } from "@/lib/partner-api";

/** Phase 18: step into a client shop that granted this partner access. */
export async function POST(request: Request) {
  try {
    const me = await requirePartner();
    if (me.partner.status !== "active") {
      return NextResponse.json({ ok: false, error: "Your partner account is waiting for Guma Kart approval." }, { status: 403 });
    }
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(await request.json());
    const access = await verifyPartnerAccess(me.userId, me.partner.id, tenantId);
    if (!access) return NextResponse.json({ ok: false, error: "This shop hasn't given you access (or removed it)." }, { status: 403 });
    const token = await createSessionToken({
      userId: me.userId,
      email: me.email,
      role: "seller_staff",
      staffRole: access.role,
      tenantId: access.tenantId,
      tenantSlug: access.tenantSlug,
      tenantName: access.tenantName,
      displayName: me.displayName,
      emailVerified: true,
      needsShopSetup: false,
      sessionVersion: me.sessionVersion,
      partnerAccess: me.partner.id,
    });
    await touchPartnerOpen(me.partner.id, tenantId);
    const response = NextResponse.json({ ok: true, redirectTo: homeFor(access.role) });
    response.headers.set("Set-Cookie", sessionCookieHeader(token));
    return response;
  } catch (error) {
    return partnerFail(error, "open");
  }
}
