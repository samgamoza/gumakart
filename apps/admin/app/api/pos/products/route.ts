import { NextResponse } from "next/server";
import { getDb, listPosProducts, resolvePosLocationId } from "@gumakart/db";
import { posBranchId, posErrorResponse, requirePosActor } from "@/lib/pos-auth";

export async function GET(request: Request) {
  try {
    const actor = await requirePosActor();
    const q = new URL(request.url).searchParams.get("q")?.slice(0, 80) ?? undefined;
    // Phase 17: stock shown is this register's branch (when the shop has branches).
    const locationId = await resolvePosLocationId(getDb(), actor.tenantId, await posBranchId());
    return NextResponse.json({ ok: true, products: await listPosProducts(actor.tenantId, q, locationId) });
  } catch (error) {
    return posErrorResponse(error, "products");
  }
}
