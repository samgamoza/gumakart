import { NextResponse } from "next/server";
import { findSocialAccountByExternal, recordSocialMessage } from "@gumakart/db";
import { parseWhatsAppWebhook, verifyMetaSignature, whatsAppAppSecret, whatsAppVerifyToken } from "@gumakart/services";
import { handleReviewReply } from "@/lib/ai-suite-growth";
import { CLOSER_DEBOUNCE_MS, handleCloserPostback, isCloserPostback, notifySeller, runAfterResponse, runCloserForThread } from "@/lib/social-automation";

/**
 * WhatsApp Cloud API webhook (AI suite Phase 3).
 * Callback URL in the Meta app (WhatsApp → Configuration): https://admin.guma.one/api/webhooks/whatsapp
 *  - GET: subscription check (hub.verify_token must equal WHATSAPP_VERIFY_TOKEN, else META_VERIFY_TOKEN).
 *  - POST: X-Hub-Signature-256 checked against WHATSAPP_APP_SECRET (else META_APP_SECRET); each buyer
 *    message is saved to the shop that connected that number (repeats ignored), then the AI closer
 *    answers after the response on Pro Live / Enterprise Vibe.
 * Status updates (sent / delivered / read) are ignored.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = whatsAppVerifyToken();
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const secret = whatsAppAppSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (!(await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret))) {
    return NextResponse.json({ ok: false, error: "Bad signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "not json" });
  }
  let saved = 0;
  const background: Array<() => Promise<unknown>> = [];
  for (const event of parseWhatsAppWebhook(body)) {
    try {
      const account = await findSocialAccountByExternal("whatsapp", event.phoneNumberId);
      if (!account) continue;
      const result = await recordSocialMessage({
        account: { id: account.id, tenantId: account.tenantId, platform: "whatsapp" },
        userId: event.waId,
        messageId: event.messageId,
        text: event.text,
        kind: event.kind,
        payload: event.buttonId || event.mediaId ? { ...(event.buttonId ? { buttonId: event.buttonId } : {}), ...(event.mediaId ? { mediaId: event.mediaId } : {}) } : null,
        at: event.at,
        buyerName: event.name,
      });
      if (!result.created) continue;
      saved += 1;
      const { tenantId } = account;
      const threadId = result.threadId;
      background.push(() =>
        notifySeller(tenantId, { title: "New WhatsApp message", body: event.text.slice(0, 120) || "Sent an attachment", url: `/inbox?t=${threadId}`, tag: `chat-${threadId}` })
      );
      if (isCloserPostback(event.buttonId)) {
        background.push(() => handleCloserPostback({ tenantId, threadId, payload: event.buttonId! }));
      } else {
        background.push(async () => {
          // AI suite Phase 4: a reply to the post-delivery review question is the review, not a chat for the closer.
          const reviewed = await handleReviewReply({ tenantId, threadId, accountId: account.id, platform: "whatsapp", recipientId: event.waId, text: event.text, waMediaId: event.mediaId ?? null }).catch((error) => {
            console.error("[webhooks/whatsapp] review reply failed", error);
            return false;
          });
          if (!reviewed) await runCloserForThread(tenantId, threadId, { debounceMs: CLOSER_DEBOUNCE_MS });
        });
      }
    } catch (error) {
      console.error("[webhooks/whatsapp] event failed", error);
    }
  }
  if (background.length) runAfterResponse(background, "webhooks/whatsapp");
  return NextResponse.json({ ok: true, saved, queued: background.length });
}
