import { NextResponse } from "next/server";
import { z } from "zod";
import { PlatformError, getWebhookSecretSealed, randomSecret, setWebhookSecret } from "@gumakart/db";
import { openToken, sealToken } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { devFail } from "@/lib/developer-api";

/** { action: "reveal" } shows the signing secret; { action: "rotate" } replaces it (old one stops working at once). */
export async function POST(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { endpointId } = await params;
    z.string().uuid().parse(endpointId);
    const { action } = z.object({ action: z.enum(["reveal", "rotate"]) }).parse(await request.json());
    if (action === "rotate") {
      const secret = randomSecret("whsec_", 24);
      await setWebhookSecret(session.tenantId, endpointId, await sealToken(secret));
      await recordActivity(session, { action: "webhook.secret_rotated", entityType: "webhook", entityId: endpointId, summary: "Rotated a webhook signing secret" });
      return NextResponse.json({ ok: true, secret });
    }
    const sealed = await getWebhookSecretSealed(session.tenantId, endpointId);
    if (!sealed) throw new PlatformError("NOT_FOUND", "That webhook doesn't exist.");
    const secret = await openToken(sealed);
    if (!secret) return NextResponse.json({ ok: false, error: "This secret can't be read any more. Rotate it." }, { status: 409 });
    return NextResponse.json({ ok: true, secret });
  } catch (error) {
    return devFail(error, "webhooks secret");
  }
}
