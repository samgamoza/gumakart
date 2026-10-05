import { NextResponse } from "next/server";
import { z } from "zod";
import { recordReturn, REFUND_METHODS } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { afterSaleFail, paymongoPartialRefund } from "@/lib/after-sale";

const schema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1).max(999),
        restock: z.boolean(),
        replacementVariantId: z.string().uuid().nullish(),
      })
    )
    .max(100),
  refundAmount: z.number().min(0).max(10_000_000),
  collectedAmount: z.number().min(0).max(10_000_000).optional(),
  refundMethod: z.enum(REFUND_METHODS),
  note: z.string().max(300).nullish(),
});

/** Return, exchange or partial refund after the buyer has the goods (manager/owner). */
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = schema.parse(await request.json());
    const result = await recordReturn(session.tenantId, orderId, body, { userId: session.userId, name: session.displayName ?? "Seller" }, {
      refundAtGateway: paymongoPartialRefund,
    });
    await recordActivity(session, {
      action: result.refunded > 0 ? "order.refunded_partly" : "order.returned",
      entityType: "order",
      entityId: orderId,
      summary: result.summary,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return afterSaleFail(error, "order return");
  }
}
