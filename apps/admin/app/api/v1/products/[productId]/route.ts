import { NextResponse } from "next/server";
import { apiGetProduct } from "@gumakart/db";
import { notFound, withApi } from "@/lib/public-api";

/** GET /api/v1/products/{id} */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  return withApi(request, "products:read", async (p) => {
    const { productId } = await params;
    const found = await apiGetProduct(p.tenantId, productId);
    return found ? NextResponse.json({ data: found }) : notFound("Product");
  });
}
