import { NextResponse } from "next/server";
import { z } from "zod";
import { getReplyFacts, getSocialThread } from "@gumakart/db";
import type { RepliesOutput } from "@gumakart/ai";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAssistForTenant } from "@/lib/ai-assist";

const storefront = () => (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010").replace(/\/$/, "");

/**
 * Phase 26: three suggested replies to the buyer's latest message, using only the shop's own
 * product names, prices and stock. They fill the reply box — nothing is sent automatically.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const thread = await getSocialThread(session.tenantId, threadId);
    if (!thread) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === "in" && m.body.trim());
    if (!lastIn) return NextResponse.json({ ok: false, error: "No buyer message to reply to yet." }, { status: 400 });
    const facts = await getReplyFacts(session.tenantId);
    const result = await runAssistForTenant<RepliesOutput>(session.tenantId, "replies", {
      shopName: session.tenantName,
      buyerMessage: lastIn.body,
      facts,
      checkoutLink: `${storefront()}/${session.tenantSlug}`,
    });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, replies: result.output.replies });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    console.error("[inbox/suggest-replies]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
