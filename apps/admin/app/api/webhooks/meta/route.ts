import { NextResponse } from "next/server";
import {
  findSocialAccountByExternal,
  listPushSubscriptionsForTenant,
  deletePushSubscriptions,
  recordSocialMessage,
} from "@gumakart/db";
import { getMetaProfileName, isPushConfigured, openToken, parseMetaWebhook, sendPushNotifications, verifyMetaSignature } from "@gumakart/services";

/**
 * Meta webhook for Messenger + Instagram (Phase 13, ready to hook up).
 * Callback URL in the Meta app: https://admin.guma.one/api/webhooks/meta
 *  - GET: subscription check (hub.verify_token must equal META_VERIFY_TOKEN).
 *  - POST: X-Hub-Signature-256 checked against META_APP_SECRET, then each message is saved
 *    to the shop that connected that Page / Instagram account (repeats are ignored).
 * Always answers fast with 200 once the signature is good (Meta retries otherwise).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.META_VERIFY_TOKEN?.trim();
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET?.trim();
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
  for (const event of parseMetaWebhook(body)) {
    try {
      const account = await findSocialAccountByExternal(event.platform, event.accountExternalId);
      if (!account) continue;
      const result = await recordSocialMessage({
        account: { id: account.id, tenantId: account.tenantId, platform: account.platform },
        userId: event.userId,
        messageId: event.messageId,
        text: event.text,
        kind: event.kind,
        payload: event.attachments.length ? { attachments: event.attachments } : null,
        at: event.at,
        echo: event.echo,
      });
      if (!result.created) continue;
      saved += 1;
      if (result.isNewThread && !event.echo) {
        // First message from this buyer: fetch their name (best effort).
        const token = await openToken(account.accessTokenSealed);
        const name = token ? await getMetaProfileName(event.platform, event.userId, token) : null;
        if (name) {
          await recordSocialMessage({
            account: { id: account.id, tenantId: account.tenantId, platform: account.platform },
            userId: event.userId,
            messageId: event.messageId,
            text: event.text,
            kind: event.kind,
            at: event.at,
            buyerName: name,
          });
        }
      }
      if (!event.echo && isPushConfigured()) {
        const subs = await listPushSubscriptionsForTenant(account.tenantId);
        if (subs.length) {
          const { expiredEndpoints } = await sendPushNotifications(subs, {
            title: event.platform === "instagram" ? "New Instagram message" : "New Messenger message",
            body: event.text.slice(0, 120) || "Sent an attachment",
            url: `/inbox?t=${result.threadId}`,
            tag: `chat-${result.threadId}`,
          });
          if (expiredEndpoints.length) await deletePushSubscriptions(expiredEndpoints);
        }
      }
    } catch (error) {
      console.error("[webhooks/meta] event failed", error);
    }
  }
  return NextResponse.json({ ok: true, saved });
}
