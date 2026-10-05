/**
 * Phase 13 — Messenger + Instagram via the Meta Graph API. READY TO HOOK UP.
 *
 * Turns on with META_APP_ID + META_APP_SECRET + META_VERIFY_TOKEN on the admin Worker, after
 * Meta business verification and app review (pages_messaging, pages_manage_metadata,
 * pages_show_list, instagram_basic, instagram_manage_messages). Until then:
 *  - production: nothing is sent and the shop sees "Malapit na";
 *  - local/dev (allowIntegrationMocks): a demo Page can be connected and sends are recorded as
 *    labeled mocks.
 *
 * Messenger and Instagram both send through the Facebook Page: POST /{page-id}/messages with
 * the Page access token. Replies are allowed within 24 h of the buyer's last message
 * (messaging_type RESPONSE); after that Meta requires a message tag, which we don't use.
 */

import { allowIntegrationMocks } from "../config/runtime-mode";

export const META_GRAPH = "https://graph.facebook.com/v21.0";
export const META_REPLY_WINDOW_MS = 24 * 3_600_000;

export const META_LOGIN_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
];

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim() && process.env.META_VERIFY_TOKEN?.trim());
}

/** "live" = real Meta app; "demo" = dev mocks; "off" = production without keys. */
export function metaMode(): "live" | "demo" | "off" {
  if (metaConfigured()) return "live";
  return allowIntegrationMocks() ? "demo" : "off";
}

export function metaLoginUrl(input: { redirectUri: string; state: string }): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", process.env.META_APP_ID ?? "");
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  u.searchParams.set("scope", META_LOGIN_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

async function graph<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const u = new URL(`${META_GRAPH}${path}`);
  for (const [k, v] of Object.entries(init.params ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), {
    method: init.method ?? "GET",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || (data as { error?: unknown }).error) {
    const err = (data as { error?: { message?: string; code?: number } }).error;
    throw new MetaApiError(err?.message ?? `Meta API error (${res.status})`, err?.code ?? res.status);
  }
  return data;
}

export class MetaApiError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** OAuth code → long-lived user token (≈60 days); Page tokens from it don't expire. */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const short = await graph<{ access_token: string }>("/oauth/access_token", {
    params: { client_id: process.env.META_APP_ID ?? "", client_secret: process.env.META_APP_SECRET ?? "", redirect_uri: redirectUri, code },
  });
  const long = await graph<{ access_token: string }>("/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID ?? "",
      client_secret: process.env.META_APP_SECRET ?? "",
      fb_exchange_token: short.access_token,
    },
  });
  return long.access_token;
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  instagram: { id: string; username: string | null; name: string | null } | null;
}

export async function listMetaPages(userToken: string): Promise<MetaPage[]> {
  const data = await graph<{
    data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string; name?: string } }>;
  }>("/me/accounts", { params: { access_token: userToken, fields: "id,name,access_token,instagram_business_account{id,username,name}", limit: "50" } });
  return data.data.map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null, name: p.instagram_business_account.name ?? null } : null,
  }));
}

/** Ask Meta to send this Page's messages to our webhook. */
export async function subscribeMetaPage(pageId: string, pageToken: string): Promise<void> {
  await graph(`/${pageId}/subscribed_apps`, {
    method: "POST",
    params: { access_token: pageToken, subscribed_fields: "messages,messaging_postbacks,message_echoes" },
  });
}

/** Buyer's display name (best effort; Meta often withholds it until the app is reviewed). */
export async function getMetaProfileName(platform: "messenger" | "instagram", userId: string, pageToken: string): Promise<string | null> {
  try {
    if (platform === "instagram") {
      const p = await graph<{ name?: string; username?: string }>(`/${userId}`, { params: { access_token: pageToken, fields: "name,username" } });
      return p.name || (p.username ? `@${p.username}` : null);
    }
    const p = await graph<{ first_name?: string; last_name?: string; name?: string }>(`/${userId}`, { params: { access_token: pageToken, fields: "first_name,last_name,name" } });
    return p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(app secret, raw body). */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return safeEqual(sig, header.slice("sha256=".length).toLowerCase());
}

export interface MetaInboundEvent {
  platform: "messenger" | "instagram";
  /** Page id (Messenger) or Instagram account id: which connected account. */
  accountExternalId: string;
  /** The buyer (PSID / IGSID). For echoes, the recipient. */
  userId: string;
  /** Sent by the Page itself (e.g. from Meta Business Suite) — recorded as outgoing. */
  echo: boolean;
  messageId: string;
  text: string;
  kind: "text" | "image" | "other";
  attachments: Array<{ type: string; url: string | null }>;
  at: Date;
}

interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string; payload?: { url?: string } }>; is_deleted?: boolean };
  postback?: { mid?: string; title?: string; payload?: string };
}

/** Flattens a Messenger/Instagram webhook body into message events (ignores reads, reactions…). */
export function parseMetaWebhook(body: unknown): MetaInboundEvent[] {
  const b = body as { object?: string; entry?: Array<{ id?: string; time?: number; messaging?: RawMessaging[] }> };
  if (b?.object !== "page" && b?.object !== "instagram") return [];
  const platform = b.object === "instagram" ? "instagram" : "messenger";
  const out: MetaInboundEvent[] = [];
  for (const entry of b.entry ?? []) {
    const accountId = String(entry.id ?? "");
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      const postback = m.postback;
      if ((!msg && !postback) || msg?.is_deleted) continue;
      const echo = Boolean(msg?.is_echo);
      const userId = String((echo ? m.recipient?.id : m.sender?.id) ?? "");
      const mid = String(msg?.mid ?? postback?.mid ?? "");
      if (!accountId || !userId || !mid) continue;
      const attachments = (msg?.attachments ?? []).map((a) => ({ type: String(a.type ?? "file"), url: a.payload?.url ?? null }));
      const text = msg?.text ?? postback?.title ?? (attachments.length ? `[${attachments.map((a) => a.type).join(", ")}]` : "");
      out.push({
        platform,
        accountExternalId: accountId,
        userId,
        echo,
        messageId: mid,
        text: text.slice(0, 4000),
        kind: msg?.text || postback ? "text" : attachments.some((a) => a.type === "image") ? "image" : "other",
        attachments,
        at: new Date(m.timestamp ?? entry.time ?? Date.now()),
      });
    }
  }
  return out;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type MetaOutgoing =
  | { type: "text"; text: string }
  | {
      type: "product";
      title: string;
      subtitle: string;
      imageUrl: string | null;
      url: string;
      buttonTitle: string;
    };

export function metaMessagePayload(message: MetaOutgoing): Record<string, unknown> {
  if (message.type === "text") return { text: message.text.slice(0, 2000) };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [
          {
            title: message.title.slice(0, 80),
            subtitle: message.subtitle.slice(0, 80),
            ...(message.imageUrl ? { image_url: message.imageUrl } : {}),
            default_action: { type: "web_url", url: message.url },
            buttons: [{ type: "web_url", url: message.url, title: message.buttonTitle.slice(0, 20) }],
          },
        ],
      },
    },
  };
}

export interface MetaSendResult {
  success: boolean;
  messageId?: string;
  mock?: boolean;
  error?: string;
}

export async function sendMetaMessage(input: {
  pageId: string;
  pageToken: string | null;
  recipientId: string;
  message: MetaOutgoing;
}): Promise<MetaSendResult> {
  if (!input.pageToken) {
    if (allowIntegrationMocks()) return { success: true, mock: true, messageId: `mock_mid_${Date.now()}` };
    return { success: false, error: "This Page isn't connected. Reconnect it in Channels." };
  }
  try {
    const data = await graph<{ message_id?: string }>(`/${input.pageId}/messages`, {
      method: "POST",
      params: { access_token: input.pageToken },
      body: { recipient: { id: input.recipientId }, messaging_type: "RESPONSE", message: metaMessagePayload(input.message) },
    });
    return { success: true, messageId: data.message_id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message.slice(0, 280) : "Send failed" };
  }
}
