import { NextResponse } from "next/server";
import { z } from "zod";
import {
  beginSocialSend,
  finishSocialSend,
  getChatCheckoutLink,
  getChatProductCard,
  getSocialAccountForSend,
  getTenantSettings,
  InboxError,
  setSocialMessageContent,
  type SalesChannel,
} from "@gumakart/db";
import { openToken, sendMetaMessage, type MetaOutgoing } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail, checkoutLinkShareUrl, productShareUrl, publicImageUrl } from "@/lib/channels";

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("product"), productId: z.string().uuid(), variantId: z.string().uuid().nullish(), note: z.string().max(300).optional() }),
  z.object({ type: z.literal("link"), checkoutLinkId: z.string().uuid(), note: z.string().max(300).optional() }),
]);

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Reply in a Messenger / Instagram chat: text, a product card, or a checkout link. Links
 * carry ?ref=<channel>&th=<chat>, so an order placed from them shows in this chat and in
 * the channel report.
 */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { threadId } = await params;
    z.string().uuid().parse(threadId);
    const body = bodySchema.parse(await request.json());
    const shop = await getTenantSettings(session.tenantId);
    if (!shop) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    const who = session.displayName?.split(" ")[0] || "Seller";

    let message: MetaOutgoing;
    let kind: "text" | "product" | "link" = "text";
    let preview: string;
    let payload: Record<string, unknown> | null = null;
    // The platform is known only after we load the thread; links are tagged per channel below.
    const draft = await beginSocialSend({
      tenantId: session.tenantId,
      threadId,
      kind: body.type,
      body: body.type === "text" ? body.text : "…",
      sentByName: who,
    });
    const channel: SalesChannel = draft.thread.platform === "instagram" ? "instagram" : "messenger";
    try {
      if (body.type === "text") {
        message = { type: "text", text: body.text };
        preview = body.text;
      } else if (body.type === "product") {
        const card = await getChatProductCard(session.tenantId, body.productId, body.variantId);
        if (!card) throw new InboxError("That product isn't for sale right now.", "INVALID");
        const url = productShareUrl(shop.slug, card.slug, channel, threadId);
        kind = "product";
        message = { type: "product", title: card.title, subtitle: `${peso(card.price)} · ${shop.name}`, imageUrl: publicImageUrl(card.imageUrl), url, buttonTitle: "Order na" };
        preview = `${card.title} · ${peso(card.price)}`;
        payload = { productId: card.productId, variantId: card.variantId, url, price: card.price, title: card.title, imageUrl: card.imageUrl };
      } else {
        const link = await getChatCheckoutLink(session.tenantId, body.checkoutLinkId);
        if (!link) throw new InboxError("That checkout link is off or gone.", "INVALID");
        const url = checkoutLinkShareUrl(link.code, channel, threadId);
        kind = "link";
        const text = `${body.note?.trim() ? `${body.note.trim()}\n` : ""}${link.title}: ${url}`;
        message = { type: "text", text };
        preview = text;
        payload = { checkoutLinkId: link.id, url, title: link.title };
      }
    } catch (error) {
      await finishSocialSend(session.tenantId, threadId, draft.messageId, { success: false, error: error instanceof Error ? error.message : "Not sent" }, "");
      throw error;
    }

    const account = await getSocialAccountForSend(session.tenantId, draft.thread.accountId);
    const pageId = account?.pageId ?? account?.externalId ?? "";
    const result = account
      ? await sendMetaMessage({ pageId, pageToken: await openToken(account.accessTokenSealed), recipientId: draft.thread.externalUserId, message })
      : { success: false, error: "This chat's Page is no longer connected." };
    await finishSocialSend(
      session.tenantId,
      threadId,
      draft.messageId,
      { success: result.success, externalMessageId: "messageId" in result ? result.messageId : null, mock: "mock" in result ? result.mock : false, error: result.error ?? null },
      preview
    );
    // Store what was actually sent (the draft body was a placeholder for cards/links).
    await setSocialMessageContent(session.tenantId, draft.messageId, { kind, body: preview, payload });
    if (!result.success) return NextResponse.json({ ok: false, error: result.error ?? "Meta didn't accept the message." }, { status: 502 });
    return NextResponse.json({ ok: true, mock: "mock" in result ? Boolean(result.mock) : false });
  } catch (error) {
    return channelFail(error, "inbox send");
  }
}

