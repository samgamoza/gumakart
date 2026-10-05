import { NextResponse } from "next/server";
import { getLowStockThreshold, listInventory } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "./_errors";

/** Phase 9 — every stock-tracked variant in the shop, plus the low-stock threshold. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [rows, threshold] = await Promise.all([listInventory(session.tenantId), getLowStockThreshold(session.tenantId)]);
    return NextResponse.json({ ok: true, rows, threshold });
  } catch (error) {
    return inventoryFail(error, "GET");
  }
}
