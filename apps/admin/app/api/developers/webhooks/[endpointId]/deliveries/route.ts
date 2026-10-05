import { NextResponse } from "next/server";
import { z } from "zod";
import { listWebhookDeliveries } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { devFail } from "@/lib/developer-api";

export async function GET(_request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { endpointId } = await params;
    z.string().uuid().parse(endpointId);
    return NextResponse.json({ ok: true, deliveries: await listWebhookDeliveries(session.tenantId, endpointId, 30) });
  } catch (error) {
    return devFail(error, "webhooks deliveries");
  }
}
