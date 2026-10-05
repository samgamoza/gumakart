import { NextResponse } from "next/server";
import { z } from "zod";
import { disconnectSocialAccount } from "@gumakart/db";
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
