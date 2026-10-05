import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformError, WEBHOOK_EVENTS, deleteWebhookEndpoint, updateWebhookEndpoint, validateWebhookUrl } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { devFail } from "@/lib/developer-api";
import { allowLocalWebhooks } from "@/lib/webhook-sender";

const patchSchema = z.object({
  url: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(120).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event.").optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { endpointId } = await params;
    z.string().uuid().parse(endpointId);
    const body = patchSchema.parse(await request.json());
    let url: string | undefined;
    if (body.url !== undefined) {
      const check = validateWebhookUrl(body.url, { allowLocal: allowLocalWebhooks() });
      if (!check.ok) throw new PlatformError("INVALID", check.error);
      url = check.url;
    }
    await updateWebhookEndpoint(session.tenantId, endpointId, { ...body, url });
    const what = body.active === true ? "Turned on" : body.active === false ? "Turned off" : "Updated";
    await recordActivity(session, { action: "webhook.updated", entityType: "webhook", entityId: endpointId, summary: `${what} a webhook${url ? ` (${new URL(url).host})` : ""}` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return devFail(error, "webhooks update");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { endpointId } = await params;
    z.string().uuid().parse(endpointId);
    await deleteWebhookEndpoint(session.tenantId, endpointId);
    await recordActivity(session, { action: "webhook.deleted", entityType: "webhook", entityId: endpointId, summary: "Removed a webhook" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return devFail(error, "webhooks delete");
  }
}
