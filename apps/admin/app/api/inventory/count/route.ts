import { NextResponse } from "next/server";
import { z } from "zod";
import { applyStockChanges } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "../_errors";

const schema = z.object({
  changes: z
    .array(z.object({ variantId: z.string().uuid(), stockQty: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(2000),
  note: z.string().trim().max(120).optional(),
});

/** Save a stock count: counted numbers replace the system numbers, each logged in the stock history. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const result = await applyStockChanges(session.tenantId, body.changes, {
      note: body.note ? `Stock count: ${body.note}` : "Stock count",
      actorId: session.userId ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return inventoryFail(error, "count");
  }
}
