import { NextResponse } from "next/server";
import { z } from "zod";
import { getBranchStock, setBranchCount } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { branchFail } from "@/lib/branch-api";

/** Phase 17: stock per branch (GET) and a count at one branch (PUT). */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const q = new URL(request.url).searchParams.get("q");
    return NextResponse.json({ ok: true, ...(await getBranchStock(session.tenantId, { q })) });
  } catch (error) {
    return branchFail(error, "stock");
  }
}

const countSchema = z.object({
  locationId: z.string().uuid(),
  items: z.array(z.object({ variantId: z.string().uuid(), qty: z.number().int().min(0).max(1_000_000) })).min(1).max(2000),
});

export async function PUT(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = countSchema.parse(await request.json());
    const result = await setBranchCount(session.tenantId, body.locationId, body.items, { userId: session.userId, name: session.displayName ?? "Seller" });
    if (result.changed) await recordActivity(session, { action: "stock.branch_count", entityType: "location", entityId: body.locationId, summary: `Counted stock at a branch: ${result.changed} item(s) changed` });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return branchFail(error, "count");
  }
}
