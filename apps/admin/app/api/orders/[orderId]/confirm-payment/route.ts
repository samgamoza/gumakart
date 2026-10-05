import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmManualOrderPayment } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const bodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Seller confirms direct GCash/Maya/bank payment for a pending order. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    const result = await confirmManualOrderPayment({
      tenantId: session.tenantId,
      orderId,
      actorId: session.userId,
      note: body.note,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    if (result.transitioned) {
      await recordActivity(session, {
        action: "order.payment_confirmed",
        entityType: "order",
        entityId: orderId,
        summary: `Confirmed payment for ${result.orderNumber}`,
      });
    }
    return NextResponse.json({
      ok: true,
      orderNumber: result.orderNumber,
      transitioned: result.transitioned,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }
    console.error("[confirm-payment]", error);
    return NextResponse.json({ ok: false, error: "Could not confirm payment." }, { status: 500 });
  }
}
