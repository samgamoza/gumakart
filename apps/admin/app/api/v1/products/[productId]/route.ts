import { NextResponse } from "next/server";
import { z } from "zod";
import { apiGetProduct, apiUpdateProduct } from "@gumakart/db";
import { logApiActivity, notFound, withApi } from "@/lib/public-api";

/** GET /api/v1/products/{id} */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  return withApi(request, "products:read", async (p) => {
    const { productId } = await params;
    const found = await apiGetProduct(p.tenantId, productId);
    return found ? NextResponse.json({ data: found }) : notFound("Product");
  });
}

const patchSchema = z
  .object({
    title: z.string().trim().min(2).max(255).optional(),
    description_html: z.string().max(20_000).nullish(),
    price: z.number().min(0).max(10_000_000).optional(),
    compare_at_price: z.number().min(0).max(10_000_000).nullish(),
    status: z.enum(["draft", "active", "archived"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Send at least one field to change.");

/** PATCH /api/v1/products/{id} — title, description, price, compare-at price, status. Never deletes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  return withApi(request, "products:write", async (p) => {
    const { productId } = await params;
    const body = patchSchema.parse(await request.json());
    const product = await apiUpdateProduct(p.tenantId, productId, body);
    if (!product) return notFound("Product");
    await logApiActivity(p, { action: "product.api_updated", entityType: "product", entityId: product.id, summary: `Updated ${product.title} through the API (${Object.keys(body).join(", ")})` });
    return NextResponse.json({ data: product });
  });
}
