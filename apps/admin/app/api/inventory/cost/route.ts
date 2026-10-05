import { NextResponse } from "next/server";
import { z } from "zod";
import { applyStockChanges } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "../_errors";

/** Phase 14: set (or clear) one variant's cost price — used for profit and stock value. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = z.object({ variantId: z.string().uuid(), costPrice: z.number().min(0).max(999_999).nullable() }).parse(await request.json());
    const result = await applyStockChanges(session.tenantId, [{ variantId: body.variantId, costPrice: body.costPrice }], {
      note: "Cost price",
      actorId: session.userId ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return inventoryFail(error, "cost");
  }
}
