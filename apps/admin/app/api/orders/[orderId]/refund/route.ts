import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderError, refundOrder } from "@gumakart/db";
import { createLogger, createPayMongoClient } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { orderNumberFor } from "@gumakart/db";

const log = createLogger("orders:refund");

/**
 * Refunds a paid order exactly once (order row locked NOWAIT for the whole
 * operation — a double click gets "already in progress", not a second refund).
 *
 * PayMongo payments are refunded through the PayMongo refunds API inside that
 * lock. Direct e-wallet/bank transfers and COD are marked refunded and the
 * seller returns the money to the buyer themselves.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);

    const result = await refundOrder({
      tenantId: session.tenantId,
      orderId,
      actorId: session.userId,
      refundAtGateway: async (req) => {
        if (!req.gatewayPaymentId) {
          throw new OrderError(
            "No PayMongo payment reference found for this order — contact support to refund it.",
            "INVALID_TRANSITION"
          );
        }
        const refund = await createPayMongoClient().createRefund({
          paymentId: req.gatewayPaymentId,
          amountCentavos: req.totalCentavos,
          reason: "requested_by_customer",
          notes: `Refund for order ${req.orderNumber}`,
        });
        return { refundId: refund.id };
      },
    });

    await recordActivity(session, {
      action: "order.refunded",
      entityType: "order",
      entityId: orderId,
      summary: `Refunded ${(await orderNumberFor(session.tenantId, orderId)) ?? "an order"}${result.refundedOutsidePlatform ? " (paid outside Guma — refund sent by the shop)" : ""}${result.restocked ? ", items restocked" : ""}`,
    });
    return NextResponse.json({
      ok: true,
      status: "refunded",
      refundId: result.refundId ?? null,
      refundedOutsidePlatform: result.refundedOutsidePlatform,
      restocked: result.restocked,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid order id." }, { status: 400 });
    }
    if (error instanceof OrderError) {
      const status = error.code === "ORDER_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    const gatewayRefundId =
      error && typeof error === "object" && "gatewayRefundId" in error
        ? String((error as { gatewayRefundId: unknown }).gatewayRefundId)
        : undefined;
    log.error("Refund failed", error, gatewayRefundId ? { gatewayRefundId } : undefined);
    return NextResponse.json(
      {
        ok: false,
        error: gatewayRefundId
          ? `The buyer was refunded (PayMongo ${gatewayRefundId}) but we couldn't update the order. Contact support with this reference.`
          : "Refund failed. Try again or contact support.",
      },
      { status: 502 }
    );
  }
}
