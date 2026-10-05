import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderError, apiGetOrder, applyOrderAction, type OrderAction } from "@gumakart/db";
import { apiError, logApiActivity, notFound, withApi } from "@/lib/public-api";

/**
 * POST /api/v1/orders/{id or number}/actions — packing and delivery updates from a
 * fulfilment or courier tool. Payments, cancellations and refunds stay in Guma Kart.
 * Buyers get the same SMS/email updates as when the seller taps the button.
 */
const ACTIONS = {
  accept: { action: { type: "accept" }, label: "Accepted" },
  mark_ready: { action: { type: "mark_ready" }, label: "Marked packed" },
  mark_out_for_delivery: { action: { type: "fulfillment_update", to: "out_for_delivery" }, label: "Marked out for delivery" },
  mark_delivered: { action: { type: "fulfillment_update", to: "delivered" }, label: "Marked delivered" },
  mark_failed_delivery: { action: { type: "fulfillment_update", to: "failed_delivery" }, label: "Marked delivery failed" },
  mark_returned: { action: { type: "fulfillment_update", to: "returned" }, label: "Marked returned" },
} as const satisfies Record<string, { action: OrderAction; label: string }>;

const bodySchema = z.object({
  action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...Array<keyof typeof ACTIONS>]),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ order: string }> }) {
  return withApi(request, "orders:write", async (p) => {
    const { order } = await params;
    const body = bodySchema.parse(await request.json());
    const current = await apiGetOrder(p.tenantId, decodeURIComponent(order));
    if (!current) return notFound("Order");
    const spec = ACTIONS[body.action];
    try {
      const result = await applyOrderAction({
        orderId: current.id,
        tenantId: p.tenantId,
        action: spec.action,
        source: "seller",
        actorId: null,
        note: body.note ? `API (${p.tokenName}): ${body.note}` : `API (${p.tokenName})`,
      });
      if (result.changed) {
        await logApiActivity(p, {
          action: `order.${body.action}`,
          entityType: "order",
          entityId: current.id,
          summary: `${spec.label} ${current.number}`,
        });
      }
      const fresh = await apiGetOrder(p.tenantId, current.id);
      return NextResponse.json({ data: fresh, changed: result.changed });
    } catch (error) {
      if (error instanceof OrderError) return apiError(409, "invalid_state", error.message);
      throw error;
    }
  });
}
