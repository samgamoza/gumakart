import { NextResponse } from "next/server";
import { z } from "zod";
import { disconnectSocialAccount, setSocialAccountCloserMode } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { channelFail } from "@/lib/channels";

/** Disconnect a Page / Instagram account (its token is deleted; chats stay). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const ok = await disconnectSocialAccount(session.tenantId, accountId);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    await recordActivity(session, { action: "channels.meta_disconnected", entityType: "channel", entityId: accountId, summary: "Disconnected a Messenger/Instagram account" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "meta disconnect");
  }
}

/** AI suite Phase 3: AI sales closer on/off for this Page / Instagram / WhatsApp number. */
export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const { aiCloserMode } = z.object({ aiCloserMode: z.enum(["auto", "off"]) }).parse(await request.json());
    const ok = await setSocialAccountCloserMode(session.tenantId, accountId, aiCloserMode);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    await recordActivity(session, {
      action: "channels.ai_closer_mode",
      entityType: "channel",
      entityId: accountId,
      summary: aiCloserMode === "auto" ? "Turned the AI sales closer on" : "Turned the AI sales closer off",
    });
    return NextResponse.json({ ok: true, aiCloserMode });
  } catch (error) {
    return channelFail(error, "ai closer mode");
  }
}
