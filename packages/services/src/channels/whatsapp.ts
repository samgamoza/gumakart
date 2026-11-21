/**
 * AI suite Phase 3 — WhatsApp Cloud API (Meta). A shop connects a WhatsApp Business number:
 * social_accounts.platform = 'whatsapp', external_id = phone_number_id, token = a system-user
 * access token (sealed). Webhooks arrive at /api/webhooks/whatsapp, signed with the Meta app
 * secret (X-Hub-Signature-256), same as Messenger.
 *
 * Customer-service window: free-form replies are allowed within 24 h of the buyer's last
 * message (same rule we already enforce for Messenger/Instagram). Outside it WhatsApp requires an
 * approved template — the closer and the recovery job never message outside the window.
 */
import { allowIntegrationMocks } from "../config/runtime-mode";
import { META_GRAPH, type MetaOutgoing, type MetaSendResult } from "./meta";

export interface WhatsAppInboundEvent {
  /** Our connected number (social_accounts.external_id). */
  phoneNumberId: string;
  /** The buyer's WhatsApp id (their number in international format, no +). */
  waId: string;
  name: string | null;
  messageId: string;
  text: string;
  kind: "text" | "image" | "other";
  /** id of a tapped reply button / list row (e.g. "CLOSER:SWITCH_COD:<linkId>"). */
  buttonId?: string;
  /** Media id of a photo the buyer sent (download with fetchWhatsAppMedia). */
  mediaId?: string;
  at: Date;
}

interface WaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  button?: { payload?: string; text?: string };
  image?: { caption?: string; id?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
}

/** Flattens a Cloud API webhook into incoming messages (status updates are ignored). */
export function parseWhatsAppWebhook(body: unknown): WhatsAppInboundEvent[] {
  const b = body as {
    object?: string;
    entry?: Array<{ changes?: Array<{ field?: string; value?: { metadata?: { phone_number_id?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: WaMessage[] } }> }>;
  };
  if (b?.object !== "whatsapp_business_account") return [];
  const out: WhatsAppInboundEvent[] = [];
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value ?? {};
      const phoneNumberId = String(v.metadata?.phone_number_id ?? "");
      for (const m of v.messages ?? []) {
        const waId = String(m.from ?? "");
        const messageId = String(m.id ?? "");
        if (!phoneNumberId || !waId || !messageId) continue;
        const contact = (v.contacts ?? []).find((c) => c.wa_id === waId) ?? v.contacts?.[0];
        let text = "";
        let kind: WhatsAppInboundEvent["kind"] = "other";
        let buttonId: string | undefined;
        let mediaId: string | undefined;
        if (m.type === "text") {
          text = m.text?.body ?? "";
          kind = "text";
        } else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          text = r?.title ?? "";
          buttonId = r?.id;
          kind = "text";
        } else if (m.type === "button") {
          text = m.button?.text ?? "";
          buttonId = m.button?.payload;
          kind = "text";
        } else if (m.type === "image") {
          text = m.image?.caption ?? "[image]";
          kind = "image";
          mediaId = m.image?.id;
        } else {
          text = m.video?.caption ?? m.document?.caption ?? `[${m.type ?? "message"}]`;
        }
        out.push({
          phoneNumberId,
          waId,
          name: contact?.profile?.name?.slice(0, 160) ?? null,
          messageId,
          text: text.slice(0, 4000),
          kind,
          ...(buttonId ? { buttonId: buttonId.slice(0, 200) } : {}),
          ...(mediaId ? { mediaId: mediaId.slice(0, 128) } : {}),
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
    }
  }
  return out;
}

/** Cloud API message body for one of our outgoing shapes. */
export function whatsAppPayload(to: string, message: MetaOutgoing): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (message.type === "text") return { ...base, type: "text", text: { body: message.text.slice(0, 4096), preview_url: true } };
  if (message.type === "product") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "cta_url",
        ...(message.imageUrl ? { header: { type: "image", image: { link: message.imageUrl } } } : {}),
        body: { text: `${message.title}\n${message.subtitle}`.slice(0, 1024) },
        action: { name: "cta_url", parameters: { display_text: message.buttonTitle.slice(0, 20), url: message.url } },
      },
    };
  }
  // Buttons: WhatsApp can't mix link and reply buttons in one message. One link → cta_url;
  // reply buttons → interactive buttons (links are written into the text).
  const urls = message.buttons.filter((b): b is Extract<typeof b, { kind: "url" }> => b.kind === "url");
  const replies = message.buttons.filter((b): b is Extract<typeof b, { kind: "postback" }> => b.kind === "postback");
  if (!replies.length && urls.length === 1) {
    return {
      ...base,
      type: "interactive",
      interactive: { type: "cta_url", body: { text: message.text.slice(0, 1024) }, action: { name: "cta_url", parameters: { display_text: urls[0]!.title.slice(0, 20), url: urls[0]!.url } } },
    };
  }
  const text = [message.text, ...urls.map((u) => `${u.title}: ${u.url}`)].join("\n").slice(0, 1024);
  if (!replies.length) return { ...base, type: "text", text: { body: text, preview_url: true } };
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: { buttons: replies.slice(0, 3).map((r) => ({ type: "reply", reply: { id: r.payload.slice(0, 256), title: r.title.slice(0, 20) } })) },
    },
  };
}

export async function sendWhatsAppMessage(input: { phoneNumberId: string; token: string | null; to: string; message: MetaOutgoing; fetch?: typeof fetch }): Promise<MetaSendResult> {
  if (!input.token) {
    if (allowIntegrationMocks()) return { success: true, mock: true, messageId: `mock_wamid_${Date.now()}` };
    return { success: false, error: "This WhatsApp number isn't connected." };
  }
  try {
    const res = await (input.fetch ?? fetch)(`${META_GRAPH}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
      body: JSON.stringify(whatsAppPayload(input.to, input.message)),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok || data.error) return { success: false, error: (data.error?.message ?? `WhatsApp API error (${res.status})`).slice(0, 280) };
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message.slice(0, 280) : "Send failed" };
  }
}

/** Check a number + token before connecting it (returns the display number / verified name). */
export async function getWhatsAppNumberInfo(phoneNumberId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<{ displayPhone: string; verifiedName: string | null } | null> {
  try {
    const res = await fetchImpl(`${META_GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = (await res.json()) as { display_phone_number?: string; verified_name?: string };
    return d.display_phone_number ? { displayPhone: d.display_phone_number, verifiedName: d.verified_name ?? null } : null;
  } catch {
    return null;
  }
}

/** Secret the WhatsApp webhooks are signed with (a separate Meta app may be used for WhatsApp). */
export function whatsAppAppSecret(): string | null {
  return process.env.WHATSAPP_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || null;
}

export function whatsAppVerifyToken(): string | null {
  return process.env.WHATSAPP_VERIFY_TOKEN?.trim() || process.env.META_VERIFY_TOKEN?.trim() || null;
}

/**
 * AI suite Phase 4: an approved WhatsApp message template — the only thing a business may send
 * outside the 24-hour customer-service window. `bodyParams` fill {{1}}, {{2}}… in order.
 */
export async function sendWhatsAppTemplate(input: {
  phoneNumberId: string;
  token: string | null;
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
  fetch?: typeof fetch;
}): Promise<MetaSendResult> {
  if (!input.token) {
    if (allowIntegrationMocks()) return { success: true, mock: true, messageId: `mock_wamid_tpl_${Date.now()}` };
    return { success: false, error: "This WhatsApp number isn't connected." };
  }
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.language || "en" },
      ...(input.bodyParams.length
        ? { components: [{ type: "body", parameters: input.bodyParams.map((t) => ({ type: "text", text: t.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000) })) }] }
        : {}),
    },
  };
  try {
    const res = await (input.fetch ?? fetch)(`${META_GRAPH}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok || data.error) return { success: false, error: (data.error?.message ?? `WhatsApp API error (${res.status})`).slice(0, 280) };
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message.slice(0, 280) : "Send failed" };
  }
}

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/** Download a photo a buyer sent on WhatsApp (two steps: media id → short-lived URL → bytes). */
export async function fetchWhatsAppMedia(mediaId: string, token: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const meta = await fetchImpl(`${META_GRAPH}/${encodeURIComponent(mediaId)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!meta.ok) return null;
    const m = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!m.url || !isMetaCdnUrl(m.url) || (m.file_size ?? 0) > MAX_MEDIA_BYTES) return null;
    const res = await fetchImpl(m.url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) return null;
    return { bytes, contentType: m.mime_type || res.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Meta's media CDNs — the only hosts we download buyer attachments from. */
export function isMetaCdnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return [".fbcdn.net", ".fbsbx.com", ".cdninstagram.com", ".whatsapp.net"].some((d) => h.endsWith(d)) || h === "lookaside.fbsbx.com";
  } catch {
    return false;
  }
}

/** Download a Messenger / Instagram attachment URL from a signed webhook (Meta CDN only, ≤ 8 MB). */
export async function fetchMetaAttachment(url: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isMetaCdnUrl(url)) return null;
  try {
    const res = await fetchImpl(url, { redirect: "error" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_MEDIA_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) return null;
    return { bytes, contentType: res.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return null;
  }
}
