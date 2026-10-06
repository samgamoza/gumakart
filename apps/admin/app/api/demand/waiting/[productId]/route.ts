import { NextResponse } from "next/server";
import { z } from "zod";
import { listWaitingContacts } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 22: who's waiting for this item (contact details — customers.view only). */
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { productId } = await params;
    z.string().uuid().parse(productId);
    return NextResponse.json({ ok: true, contacts: await listWaitingContacts(session.tenantId, productId) });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid product." }, { status: 400 });
    console.error("[demand waiting GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
