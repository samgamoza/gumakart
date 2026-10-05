import { NextResponse } from "next/server";
import { z } from "zod";
import { claimDueDeliveries, redeliverWebhook } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { devFail } from "@/lib/developer-api";
import { sendDelivery } from "@/lib/webhook-sender";

/** Resend: queue the delivery again and try it right away (later retries follow the normal schedule). */
export async function POST(_request: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { deliveryId } = await params;
    z.string().uuid().parse(deliveryId);
    await redeliverWebhook(session.tenantId, deliveryId);
    const [claimed] = await claimDueDeliveries({ deliveryId });
    if (!claimed) return NextResponse.json({ ok: true, queued: true });
    const { outcome, status } = await sendDelivery(claimed);
    return NextResponse.json({ ok: true, delivered: outcome.ok, status, statusCode: outcome.statusCode, error: outcome.error });
  } catch (error) {
    return devFail(error, "webhooks redeliver");
  }
}
