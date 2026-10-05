import { NextResponse } from "next/server";
import { listSocialAccounts, listSocialThreads } from "@gumakart/db";
import { metaMode } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/** Messenger / Instagram chats (newest first) and the connected accounts. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") ?? "open") as "open" | "done" | "all";
    const [threads, accounts] = await Promise.all([
      listSocialThreads(session.tenantId, { status: ["open", "done", "all"].includes(status) ? status : "open", q: url.searchParams.get("q") ?? undefined }),
      listSocialAccounts(session.tenantId),
    ]);
    return NextResponse.json({ ok: true, threads, accounts, mode: metaMode() });
  } catch (error) {
    return channelFail(error, "inbox list");
  }
}
