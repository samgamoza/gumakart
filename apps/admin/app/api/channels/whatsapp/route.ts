import { NextResponse } from "next/server";
import { z } from "zod";
import { setWhatsAppAccountIds, upsertSocialAccount } from "@gumakart/db";
import { getWhatsAppNumberInfo, sealToken } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { channelFail } from "@/lib/channels";

const schema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, "Phone number ID is the long number in WhatsApp Manager → API Setup."),
  wabaId: z.string().trim().regex(/^\d{6,25}$/).optional(),
  /** A permanent System User token with whatsapp_business_messaging (stored sealed). */
  accessToken: z.string().trim().min(40).max(1000),
});

/**
 * AI suite Phase 3: connect a WhatsApp Business number (Cloud API). The token is checked against
 * the number before it's saved; messages then arrive through /api/webhooks/whatsapp.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const info = await getWhatsAppNumberInfo(body.phoneNumberId, body.accessToken);
    if (!info) {
      return NextResponse.json({ ok: false, error: "Meta didn't accept that token for this number. Check the Phone number ID and that the token has whatsapp_business_messaging." }, { status: 400 });
    }
    const account = await upsertSocialAccount({
      tenantId: session.tenantId,
      platform: "whatsapp",
      externalId: body.phoneNumberId,
      name: `${info.verifiedName ?? "WhatsApp"} (${info.displayPhone})`.slice(0, 120),
      pageId: null,
      accessTokenSealed: await sealToken(body.accessToken),
    });
    await setWhatsAppAccountIds(session.tenantId, account.id, { phoneNumberId: body.phoneNumberId, wabaId: body.wabaId ?? null });
    await recordActivity(session, { action: "channels.whatsapp_connected", entityType: "channel", entityId: account.id, summary: `Connected WhatsApp ${info.displayPhone}` });
    return NextResponse.json({ ok: true, account: { id: account.id, name: account.name, platform: "whatsapp" } }, { status: 201 });
  } catch (error) {
    return channelFail(error, "whatsapp connect");
  }
}
