import { NextResponse } from "next/server";
import { getLowStockThreshold, getWaitingCountsByVariant, listInventory } from "@gumakart/db";
import { can } from "@gumakart/db/staff-permissions";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "./_errors";

/** Phase 9 — every stock-tracked variant in the shop, plus the low-stock threshold. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [rows, threshold, waiting] = await Promise.all([
      listInventory(session.tenantId),
      getLowStockThreshold(session.tenantId),
      getWaitingCountsByVariant(session.tenantId).catch(() => new Map<string, number>()),
    ]);
    // Phase 14: cost prices only for people who can change prices (owner/manager).
    const showCost = can(session.shopRole, "products.edit");
    return NextResponse.json({
      ok: true,
      rows: showCost ? rows : rows.map(({ costPrice: _c, ...r }) => r),
      threshold,
      // Phase 22: buyers waiting for a back-in-stock text, per variant.
      waiting: Object.fromEntries(waiting),
    });
  } catch (error) {
    return inventoryFail(error, "GET");
  }
}
