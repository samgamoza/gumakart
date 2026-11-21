import { NextResponse } from "next/server";
import { z } from "zod";
import { getSocialThread, markSocialThreadRead, pauseThreadAi, resumeThreadAi, setSocialThreadStatus } from "@gumakart/db";
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

const patchSchema = z.union([
  z.object({ status: z.enum(["open", "done"]) }),
  // AI suite Phase 3: hand the chat back to the AI closer after an escalation, or take it over.
  z.object({ ai: z.enum(["resume", "pause"]) }),
]);

/** Mark done / reopen, or pause / resume the AI closer on this chat. */
export async function PATCH(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const body = patchSchema.parse(await request.json());
    const ok =
      "ai" in body
        ? body.ai === "resume"
          ? await resumeThreadAi(session.tenantId, threadId)
          : await pauseThreadAi(session.tenantId, threadId, `Taken over by ${session.displayName || "the seller"}`)
        : await setSocialThreadStatus(session.tenantId, threadId, body.status);
    if (!ok) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "inbox status");
  }
}
