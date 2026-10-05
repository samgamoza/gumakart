import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OrderError,
  applyOrderAction,
  orderBucketOf,
  rejectManualPaymentProof,
} from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { orderNumberFor } from "@gumakart/db";

/**
 * Seller order actions (Phase 2: actions, not statuses). Payment confirmation
 * has its own route (confirm-payment) and refunds go through /refund, which
 * handles the gateway.
 */
const patchSchema = z.object({
  action: z.enum([
    "accept",
    "mark_ready",
    "mark_out_for_delivery",
    "mark_delivered",
    "mark_failed_delivery",
    "mark_returned",
    "reject_payment",
    "cancel",
  ]),
  note: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = patchSchema.parse(await request.json());
    // Phase 10: packing/shipping is staff work; money and cancellations aren't.
    if (body.action === "reject_payment") assertCan(session, "orders.payments");
    if (body.action === "cancel") assertCan(session, "orders.cancel");

    if (body.action === "reject_payment") {
      const rejected = await rejectManualPaymentProof({
        tenantId: session.tenantId,
        orderId,
        actorId: session.userId,
        note: body.note,
      });
      if (!rejected.ok) {
        return NextResponse.json({ ok: false, error: rejected.error }, { status: 400 });
      }
      await recordActivity(session, {
        action: "order.payment_rejected",
        entityType: "order",
        entityId: orderId,
        summary: `Rejected the payment proof for ${(await orderNumberFor(session.tenantId, orderId)) ?? "an order"}${body.note ? `: ${body.note}` : ""}`,
      });
      return NextResponse.json({ ok: true });
    }

    const action =
      body.action === "accept"
        ? ({ type: "accept" } as const)
        : body.action === "mark_ready"
          ? ({ type: "mark_ready" } as const)
          : body.action === "cancel"
            ? ({ type: "cancel" } as const)
            : ({
                type: "fulfillment_update",
                to:
                  body.action === "mark_out_for_delivery"
                    ? "out_for_delivery"
                    : body.action === "mark_delivered"
                      ? "delivered"
                      : body.action === "mark_failed_delivery"
                        ? "failed_delivery"
                        : "returned",
              } as const);

    const result = await applyOrderAction({
      orderId,
      tenantId: session.tenantId,
      action,
      source: "seller",
      actorId: session.userId,
      note: body.note,
      cancelReason: body.reason,
    });

    if (result.changed) {
      const labels: Record<string, string> = {
        accept: "Accepted",
        mark_ready: "Marked packed",
        cancel: "Cancelled",
        mark_out_for_delivery: "Marked out for delivery",
        mark_delivered: "Marked delivered",
        mark_failed_delivery: "Marked delivery failed",
        mark_returned: "Marked returned",
      };
      await recordActivity(session, {
        action: `order.${body.action}`,
        entityType: "order",
        entityId: orderId,
        summary: `${labels[body.action] ?? body.action} ${(await orderNumberFor(session.tenantId, orderId)) ?? "an order"}${body.action === "cancel" && body.reason ? ` — ${body.reason}` : ""}`,
      });
    }
    return NextResponse.json({
      ok: true,
      changed: result.changed,
      orderState: result.after.orderState,
      paymentState: result.after.paymentState,
      fulfillmentState: result.after.fulfillmentState,
      bucket: orderBucketOf(result.after),
      cancelCourierBooking: result.cancelCourierBooking,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof OrderError) {
      const status = error.code === "ORDER_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    console.error("[orders PATCH]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
