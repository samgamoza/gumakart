import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUpdateVariant } from "@gumakart/db";
import { logApiActivity, notFound, withApi } from "@/lib/public-api";

const patchSchema = z
  .object({
    price: z.number().min(0).max(10_000_000).optional(),
    compare_at_price: z.number().min(0).max(10_000_000).nullish(),
    sku: z.string().trim().max(100).nullish(),
    barcode: z.string().trim().max(64).nullish(),
  })
  .refine((b) => Object.keys(b).length > 0, "Send at least one field to change.");

/** PATCH /api/v1/variants/{id} — price, compare-at price, SKU, barcode. Stock: PUT /api/v1/inventory. */
export async function PATCH(request: Request, { params }: { params: Promise<{ variantId: string }> }) {
  return withApi(request, "products:write", async (p) => {
    const { variantId } = await params;
    const body = patchSchema.parse(await request.json());
    const variant = await apiUpdateVariant(p.tenantId, variantId, body);
    if (!variant) return notFound("Variant");
    await logApiActivity(p, {
      action: "variant.api_updated",
      entityType: "product",
      entityId: variant.product_id,
      summary: `Updated ${variant.product_title}${variant.title !== "Default" ? ` (${variant.title})` : ""} through the API (${Object.keys(body).join(", ")})`,
    });
    return NextResponse.json({ data: variant });
  });
}
