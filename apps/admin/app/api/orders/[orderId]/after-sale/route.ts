import { NextResponse } from "next/server";
import { z } from "zod";
import { getAfterSaleView } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const view = await getAfterSaleView(session.tenantId, orderId);
    if (!view) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    return NextResponse.json({ ok: true, view });
  } catch (error) {
    return afterSaleFail(error, "after-sale view");
  }
}
