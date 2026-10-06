import { NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerLoyalty, syncLoyaltyPoints } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 27: one buyer's Suki tier, points and what they're worth. */
export async function GET(_request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { customerId } = await params;
    z.string().uuid().parse(customerId);
    await syncLoyaltyPoints({ tenantId: session.tenantId, limit: 200 }).catch((e) => console.error("[loyalty] sync", e));
    return NextResponse.json({ ok: true, loyalty: await getCustomerLoyalty(session.tenantId, customerId) });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
    console.error("[loyalty/customer]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
