import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformError, WEBHOOK_EVENTS, createWebhookEndpoint, listWebhookEndpoints, randomSecret, validateWebhookUrl } from "@gumakart/db";
import { sealToken } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { devFail } from "@/lib/developer-api";
import { allowLocalWebhooks } from "@/lib/webhook-sender";

export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, endpoints: await listWebhookEndpoints(session.tenantId), allowLocal: allowLocalWebhooks() });
  } catch (error) {
    return devFail(error, "webhooks list");
  }
}

const createSchema = z.object({
  url: z.string().trim().min(1, "Enter the URL.").max(500),
  description: z.string().trim().max(120).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

/** New endpoint — the signing secret is in this response (and can be revealed again later). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = createSchema.parse(await request.json());
    const check = validateWebhookUrl(body.url, { allowLocal: allowLocalWebhooks() });
    if (!check.ok) throw new PlatformError("INVALID", check.error);
    const secret = randomSecret("whsec_", 24);
    const id = await createWebhookEndpoint({
      tenantId: session.tenantId,
      url: check.url,
      description: body.description,
      events: body.events,
      secretSealed: await sealToken(secret),
      createdByName: session.displayName?.trim() || "Owner",
    });
    await recordActivity(session, { action: "webhook.created", entityType: "webhook", entityId: id, summary: `Added webhook ${new URL(check.url).host} (${body.events.length} event${body.events.length === 1 ? "" : "s"})` });
    return NextResponse.json({ ok: true, id, secret });
  } catch (error) {
    return devFail(error, "webhooks create");
  }
}
