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
    params: { access_token: pageToken, subscribed_fields: "messages,messaging_postbacks,message_echoes,feed" },
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
  /** AI suite Phase 3: payload of a tapped button (e.g. "CLOSER:SWITCH_COD:<linkId>"). */
  postbackPayload?: string;
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
        ...(postback?.payload ? { postbackPayload: String(postback.payload).slice(0, 200) } : {}),
      });
    }
  }
  return out;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type MetaOutgoing =
  | { type: "text"; text: string }
  | {
      /** AI suite Phase 3: text with up to 3 buttons (open a link, or send a postback payload). */
      type: "buttons";
      text: string;
      buttons: Array<{ kind: "url"; title: string; url: string } | { kind: "postback"; title: string; payload: string }>;
    }
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
  if (message.type === "buttons") {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: message.text.slice(0, 640),
          buttons: message.buttons.slice(0, 3).map((b) =>
            b.kind === "url" ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) } : { type: "postback", payload: b.payload.slice(0, 1000), title: b.title.slice(0, 20) }
          ),
        },
      },
    };
  }
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

// ─── AI suite Phase 3: comments → public reply + private reply ──────────────

export interface MetaCommentEvent {
  platform: "messenger" | "instagram";
  /** Page id (Facebook) or Instagram account id. */
  accountExternalId: string;
  commentId: string;
  /** Facebook "<pageId>_<postId>" or Instagram media id. */
  postId: string | null;
  parentId: string | null;
  fromId: string | null;
  fromName: string | null;
  text: string;
  at: Date;
  /** Written by the Page / IG account itself (our own replies) — never act on these. */
  isOwn: boolean;
}

/** Facebook Page `feed` (item=comment, verb=add) and Instagram `comments` webhook changes. */
export function parseMetaCommentEvents(body: unknown): MetaCommentEvent[] {
  const b = body as { object?: string; entry?: Array<{ id?: string; time?: number; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  if (b?.object !== "page" && b?.object !== "instagram") return [];
  const out: MetaCommentEvent[] = [];
  for (const entry of b.entry ?? []) {
    const accountId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (b.object === "page" && change.field === "feed") {
        if (v.item !== "comment" || v.verb !== "add") continue;
        const from = (v.from ?? {}) as { id?: string; name?: string };
        const commentId = String(v.comment_id ?? "");
        if (!commentId || !accountId) continue;
        out.push({
          platform: "messenger",
          accountExternalId: accountId,
          commentId,
          postId: v.post_id ? String(v.post_id) : null,
          parentId: v.parent_id ? String(v.parent_id) : null,
          fromId: from.id ? String(from.id) : null,
          fromName: from.name ? String(from.name).slice(0, 160) : null,
          text: String(v.message ?? "").slice(0, 1000),
          at: typeof v.created_time === "number" ? new Date(v.created_time * 1000) : new Date(entry.time ?? Date.now()),
          isOwn: from.id === accountId,
        });
      }
      if (b.object === "instagram" && change.field === "comments") {
        const from = (v.from ?? {}) as { id?: string; username?: string };
        const media = (v.media ?? {}) as { id?: string };
        const commentId = String(v.id ?? "");
        if (!commentId || !accountId) continue;
        out.push({
          platform: "instagram",
          accountExternalId: accountId,
          commentId,
          postId: media.id ? String(media.id) : null,
          parentId: v.parent_id ? String(v.parent_id) : null,
          fromId: from.id ? String(from.id) : null,
          fromName: from.username ? `@${String(from.username).slice(0, 150)}` : null,
          text: String(v.text ?? "").slice(0, 1000),
          at: new Date(typeof entry.time === "number" ? (entry.time < 1e12 ? entry.time * 1000 : entry.time) : Date.now()),
          isOwn: from.id === accountId,
        });
      }
    }
  }
  return out;
}

/** Public reply under the buyer's comment. */
export async function replyToComment(input: { platform: "messenger" | "instagram"; commentId: string; message: string; token: string | null }): Promise<MetaSendResult> {
  if (!input.token) {
    if (allowIntegrationMocks()) return { success: true, mock: true, messageId: `mock_reply_${Date.now()}` };
    return { success: false, error: "Not connected." };
  }
  try {
    const path = input.platform === "instagram" ? `/${input.commentId}/replies` : `/${input.commentId}/comments`;
    const data = await graph<{ id?: string }>(path, { method: "POST", params: { access_token: input.token }, body: { message: input.message.slice(0, 1000) } });
    return { success: true, messageId: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message.slice(0, 280) : "Reply failed" };
  }
}

export interface PrivateReplyResult extends MetaSendResult {
  /** The buyer's page-scoped id, so the DM lands in their chat thread. */
  recipientId?: string;
}

/**
 * Meta Private Reply: one DM to the commenter, addressed by comment id (allowed once per comment,
 * within 7 days). Works for Facebook and Instagram comments through the Page.
 */
export async function sendPrivateReply(input: { pageId: string; token: string | null; commentId: string; message: MetaOutgoing }): Promise<PrivateReplyResult> {
  if (!input.token) {
    if (allowIntegrationMocks()) return { success: true, mock: true, messageId: `mock_pr_${Date.now()}`, recipientId: `mock_psid_${input.commentId}` };
    return { success: false, error: "This Page isn't connected." };
  }
  try {
    const data = await graph<{ message_id?: string; recipient_id?: string }>(`/${input.pageId}/messages`, {
      method: "POST",
      params: { access_token: input.token },
      body: { recipient: { comment_id: input.commentId }, message: metaMessagePayload(input.message) },
    });
    return { success: true, messageId: data.message_id, recipientId: data.recipient_id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message.slice(0, 280) : "Private reply failed" };
  }
}

// ─── AI suite Phase 3: post link → Graph post id (pfbid / IG shortcode) ──────

export interface ResolvedPostId {
  postId: string;
  platform: "facebook" | "instagram";
  permalink: string | null;
}

/** "pfbid02AbC…" from a Facebook share URL, if any. */
export function extractPfbid(input: string): string | null {
  const m = /(pfbid[0-9A-Za-z]{20,})/.exec(input);
  return m ? m[1]! : null;
}

/** Instagram shortcode from /p/…, /reel/…, /tv/… URLs. */
export function extractInstagramShortcode(input: string): string | null {
  const m = /instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]{5,40})/i.exec(input);
  return m ? m[1]! : null;
}

/**
 * Newer Facebook share links (…/posts/pfbid0…, permalink.php?story_fbid=pfbid…) don't contain
 * the numeric id the webhook reports. Look the post up among the Page's recent posts (and reels /
 * videos) by permalink and return its Graph id "<pageId>_<postId>".
 */
export async function resolveFacebookPostId(input: { pageId: string; pageToken: string; reference: string; maxPages?: number }): Promise<ResolvedPostId | null> {
  const pfbid = extractPfbid(input.reference);
  const wanted = normalizeFbUrl(input.reference);
  const numericId = /\/(?:reel|videos|posts|permalink)\/(?:[\w.-]+\/)?(\d{5,25})/.exec(input.reference)?.[1] ?? null;
  for (const edge of ["published_posts", "videos"]) {
    let after: string | undefined;
    for (let page = 0; page < (input.maxPages ?? 4); page += 1) {
      const params: Record<string, string> = { access_token: input.pageToken, fields: edge === "videos" ? "id,permalink_url" : "id,permalink_url", limit: "100" };
      if (after) params.after = after;
      let data: { data?: Array<{ id: string; permalink_url?: string }>; paging?: { cursors?: { after?: string }; next?: string } };
      try {
        data = await graph(`/${input.pageId}/${edge}`, { params });
      } catch {
        break;
      }
      for (const p of data.data ?? []) {
        const link = p.permalink_url ?? "";
        const idTail = p.id.includes("_") ? p.id.slice(p.id.indexOf("_") + 1) : p.id;
        if ((pfbid && link.includes(pfbid)) || (wanted && normalizeFbUrl(link) === wanted) || (numericId && idTail === numericId)) {
          const id = edge === "videos" && !p.id.includes("_") ? `${input.pageId}_${p.id}` : p.id;
          return { postId: id, platform: "facebook", permalink: link || null };
        }
      }
      after = data.paging?.cursors?.after;
      if (!after || !data.paging?.next) break;
    }
  }
  return null;
}

function normalizeFbUrl(u: string): string | null {
  // Graph returns video/reel permalinks as site-relative paths ("/reel/123/").
  if (u.startsWith("/")) return u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  try {
    const url = new URL(u.startsWith("http") ? u : `https://${u}`);
    if (!/facebook\.com$|fb\.com$/.test(url.hostname.replace(/^(www|m|web)\./, ""))) return null;
    return `${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Instagram URL shortcode → media id the comments webhook reports. */
export async function resolveInstagramMediaId(input: { igUserId: string; token: string; reference: string; maxPages?: number }): Promise<ResolvedPostId | null> {
  const shortcode = extractInstagramShortcode(input.reference) ?? (/^[\w-]{5,40}$/.test(input.reference.trim()) ? input.reference.trim() : null);
  if (!shortcode) return null;
  let after: string | undefined;
  for (let page = 0; page < (input.maxPages ?? 4); page += 1) {
    const params: Record<string, string> = { access_token: input.token, fields: "id,shortcode,permalink", limit: "100" };
    if (after) params.after = after;
    let data: { data?: Array<{ id: string; shortcode?: string; permalink?: string }>; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      data = await graph(`/${input.igUserId}/media`, { params });
    } catch {
      return null;
    }
    const hit = (data.data ?? []).find((m) => m.shortcode === shortcode || (m.permalink ?? "").includes(`/${shortcode}`));
    if (hit) return { postId: hit.id, platform: "instagram", permalink: hit.permalink ?? null };
    after = data.paging?.cursors?.after;
    if (!after || !data.paging?.next) break;
  }
  return null;
}
