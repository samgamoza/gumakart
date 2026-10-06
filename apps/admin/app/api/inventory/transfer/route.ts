import { NextResponse } from "next/server";
import { z } from "zod";
import { transferStock } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { branchFail } from "@/lib/branch-api";

const schema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(1).max(1_000_000) })).min(1, "Enter how many to move.").max(500),
  note: z.string().trim().max(150).optional(),
});

/** Phase 17: move stock between branches (total unchanged). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const result = await transferStock(session.tenantId, body, { userId: session.userId, name: session.displayName ?? "Seller" });
    await recordActivity(session, { action: "stock.transfer", entityType: "location", entityId: body.toId, summary: `Moved ${result.moved} item(s) between branches${body.note ? ` (${body.note})` : ""}` });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return branchFail(error, "transfer");
  }
}
