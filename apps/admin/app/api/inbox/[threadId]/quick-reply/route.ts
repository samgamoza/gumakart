import { NextResponse } from "next/server";
import { z } from "zod";
import { getSocialThread, listChatMatchableProducts } from "@gumakart/db";
import { matchProductForMessage } from "@gumakart/ai/product-match";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The one-tap reply for a chat: which product the buyer's latest message is about, with its
 * price and stock from the catalog. Nothing is sent here — the seller taps to send it
 * (POST /api/inbox/:threadId/messages with type "quick_link").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const thread = await getSocialThread(session.tenantId, threadId);
    if (!thread) return NextResponse.json({ ok: false, error: "Chat not found." }, { status: 404 });
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === "in" && m.body.trim());
    if (!lastIn || !thread.canReply) return NextResponse.json({ ok: true, suggestion: null });
    const products = await listChatMatchableProducts(session.tenantId);
    const match = matchProductForMessage(lastIn.body, products);
    if (!match) return NextResponse.json({ ok: true, suggestion: null });
    return NextResponse.json({
      ok: true,
      suggestion: {
        forMessageId: lastIn.id,
        productId: match.id,
        title: match.title,
        price: match.price,
        available: match.available,
        hasOptions: match.hasOptions,
        preview: match.available
          ? match.hasOptions
            ? `${match.title} · from ${peso(match.price)} (product card, buyer picks a size/option)`
            : `Available po! ${match.title} — ${peso(match.price)}.\nOrder here: [checkout link]`
          : null,
      },
    });
  } catch (error) {
    return channelFail(error, "inbox quick reply");
  }
}
