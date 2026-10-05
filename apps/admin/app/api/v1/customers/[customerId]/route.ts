import { NextResponse } from "next/server";
import { apiGetCustomer } from "@gumakart/db";
import { notFound, withApi } from "@/lib/public-api";

/** GET /api/v1/customers/{id} */
export async function GET(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  return withApi(request, "customers:read", async (p) => {
    const { customerId } = await params;
    const found = await apiGetCustomer(p.tenantId, customerId);
    return found ? NextResponse.json({ data: found }) : notFound("Customer");
  });
}
