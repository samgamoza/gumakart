import { NextResponse } from "next/server";
import { z } from "zod";
import { claimDueDeliveries, createTestDelivery } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { devFail } from "@/lib/developer-api";
import { sendDelivery } from "@/lib/webhook-sender";

/** Sends a `webhook.test` event right now and returns what the endpoint answered. */
export async function POST(_request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { endpointId } = await params;
    z.string().uuid().parse(endpointId);
    const deliveryId = await createTestDelivery(session.tenantId, endpointId);
    const [claimed] = await claimDueDeliveries({ deliveryId });
    if (!claimed) return NextResponse.json({ ok: false, error: "Couldn't send the test. Try again." }, { status: 409 });
    const { outcome } = await sendDelivery(claimed);
    return NextResponse.json({ ok: true, delivered: outcome.ok, statusCode: outcome.statusCode, error: outcome.error, ms: outcome.ms });
  } catch (error) {
    return devFail(error, "webhooks test");
  }
}
