import { NextResponse } from "next/server";
import { can } from "@gumakart/db/staff-permissions";
import { inventoryToCsv, listInventory } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { inventoryFail } from "../_errors";

/** CSV of the shop's stock — open in Excel/Sheets, edit price or stock, import back. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    // Phase 14: the cost column is blank for people who can't see costs.
    const showCost = can(session.shopRole, "products.edit");
    const csv = inventoryToCsv((await listInventory(session.tenantId)).map((r) => (showCost ? r : { ...r, costPrice: null })));
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="stock-${date}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return inventoryFail(error, "export");
  }
}
