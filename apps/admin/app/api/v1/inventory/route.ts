import { NextResponse } from "next/server";
import { z } from "zod";
import { apiListInventory, apiSetStock, clampLimit } from "@gumakart/db";
import { logApiActivity, withApi } from "@/lib/public-api";

/**
 * GET /api/v1/inventory — stock per variant. Filters: sku, barcode. Paging: limit + cursor.
 * PUT /api/v1/inventory — set counted stock: { items: [{ variant_id | sku, stock }] } (up to
 * 500). All or nothing; every change is in the stock ledger and the activity log.
 */
export async function GET(request: Request) {
  return withApi(request, "inventory:read", async (p) => {
    const url = new URL(request.url);
    return NextResponse.json(
      await apiListInventory(p.tenantId, {
        limit: clampLimit(url.searchParams.get("limit")),
        after: url.searchParams.get("cursor"),
        sku: url.searchParams.get("sku"),
        barcode: url.searchParams.get("barcode"),
      })
    );
  });
}

const putSchema = z.object({
  items: z
    .array(
      z.object({
        variant_id: z.string().max(64).optional(),
        sku: z.string().max(100).optional(),
        stock: z.number().int().min(0).max(1_000_000),
      })
    )
    .min(1)
    .max(500),
});

export async function PUT(request: Request) {
  return withApi(request, "inventory:write", async (p) => {
    const body = putSchema.parse(await request.json());
    const result = await apiSetStock(p.tenantId, body.items, { note: `API: ${p.tokenName}` });
    if (result.changed > 0) {
      await logApiActivity(p, {
        action: "stock.api_update",
        entityType: "inventory",
        summary: `Updated stock for ${result.changed} variant${result.changed === 1 ? "" : "s"} through the API`,
      });
    }
    return NextResponse.json({ data: result.variants, changed: result.changed, unchanged: result.unchanged });
  });
}
