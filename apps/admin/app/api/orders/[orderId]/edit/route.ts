import { NextResponse } from "next/server";
import { z } from "zod";
import { editOrderItems } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { afterSaleFail, paymongoPartialRefund } from "@/lib/after-sale";

const schema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: z.string().uuid().nullish(),
        productId: z.string().uuid().nullish(),
        variantId: z.string().uuid().nullish(),
        qty: z.number().int().min(0).max(999),
      })
    )
    .min(1)
    .max(100),
  note: z.string().max(300).nullish(),
});

/** Change items on an open, unpacked order (manager/owner). */
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = schema.parse(await request.json());
    const result = await editOrderItems(session.tenantId, orderId, body.lines, { userId: session.userId, name: session.displayName ?? "Seller" }, {
      refundAtGateway: paymongoPartialRefund,
      note: body.note ?? null,
    });
    await recordActivity(session, { action: "order.edited", entityType: "order", entityId: orderId, summary: `${result.orderNumber}: ${result.summary}` });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return afterSaleFail(error, "order edit");
  }
}
