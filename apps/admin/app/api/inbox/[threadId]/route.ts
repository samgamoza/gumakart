import { NextResponse } from "next/server";
import { z } from "zod";
import { getSocialThread, markSocialThreadRead, setSocialThreadStatus } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/** One chat with its messages and the orders placed from it (opening it marks it read). */
export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const thread = await getSocialThread(session.tenantId, threadId);
    if (!thread) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    if (thread.unread > 0) await markSocialThreadRead(session.tenantId, threadId);
    return NextResponse.json({ ok: true, thread: { ...thread, unread: 0 } });
  } catch (error) {
    return channelFail(error, "inbox thread");
  }
}

/** Mark done / reopen. */
export async function PATCH(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const { status } = z.object({ status: z.enum(["open", "done"]) }).parse(await request.json());
    const ok = await setSocialThreadStatus(session.tenantId, threadId, status);
    if (!ok) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "inbox status");
  }
}
