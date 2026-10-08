import { NextResponse } from "next/server";
import { z } from "zod";
import { listPendingGatewayRefunds, settleGatewayRefund } from "@gumakart/db";
import { createLogger, createPayMongoClient } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const log = createLogger("orders:refund-retry");

/**
 * Security G2 (GK-13): a gateway refund that was recorded but could not be
 * sent (PayMongo down, network) is retried here. The row is claimed before the
 * call, so this can never send the same refund twice.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string; refundId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId, refundId } = await params;
    z.string().uuid().parse(orderId);
    z.string().uuid().parse(refundId);
    const pending = await listPendingGatewayRefunds(session.tenantId, orderId);
    const row = pending.find((r) => r.id === refundId);
    if (!row) return NextResponse.json({ ok: false, error: "Nothing to retry for this refund." }, { status: 404 });

    const sent = await settleGatewayRefund(refundId, async (req) => {
      const refund = await createPayMongoClient().createRefund({
        paymentId: req.gatewayPaymentId ?? "",
        amountCentavos: req.totalCentavos,
        reason: "requested_by_customer",
        notes: `Refund for order ${req.orderNumber}`.slice(0, 200),
      });
      return { refundId: refund.id };
    });
    if (sent.ok) {
      await recordActivity(session, { action: "order.refund_sent", entityType: "order", entityId: orderId, summary: `Gateway refund of ₱${row.amount} sent (${sent.refundId ?? "no reference"})` });
      return NextResponse.json({ ok: true, refundId: sent.refundId ?? null });
    }
    log.warn("Gateway refund retry failed", { orderId, refundId, error: sent.error });
    return NextResponse.json({ ok: false, error: `The gateway refused again: ${sent.error}` }, { status: 502 });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid id." }, { status: 400 });
    log.error("Refund retry failed", error);
    return NextResponse.json({ ok: false, error: "Retry failed." }, { status: 500 });
  }
}
