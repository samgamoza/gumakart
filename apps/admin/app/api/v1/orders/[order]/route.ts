import { NextResponse } from "next/server";
import { apiGetOrder } from "@gumakart/db";
import { notFound, withApi } from "@/lib/public-api";

/** GET /api/v1/orders/{id or order number} */
export async function GET(request: Request, { params }: { params: Promise<{ order: string }> }) {
  return withApi(request, "orders:read", async (p) => {
    const { order } = await params;
    const found = await apiGetOrder(p.tenantId, decodeURIComponent(order));
    return found ? NextResponse.json({ data: found }) : notFound("Order");
  });
}
