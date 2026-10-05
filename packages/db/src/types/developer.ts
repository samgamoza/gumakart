/**
 * Phase 15 — public API scopes, webhook events, URL rules and retry schedule. Pure (no DB),
 * shared by the admin UI, the API routes, the webhook sender and the tests.
 */

export const API_SCOPES = [
  "orders:read",
  "orders:write",
  "products:read",
  "inventory:read",
  "inventory:write",
  "customers:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, { label: string; description: string }> = {
  "orders:read": { label: "Read orders", description: "Orders with items, buyer name, phone and delivery address." },
  "orders:write": { label: "Update orders", description: "Accept, pack and update delivery status. Never payments, cancels or refunds." },
  "products:read": { label: "Read products", description: "Products, variants, prices and photos." },
  "inventory:read": { label: "Read stock", description: "Stock per variant, by SKU or barcode." },
  "inventory:write": { label: "Update stock", description: "Set counted stock per variant (logged in the activity log)." },
  "customers:read": { label: "Read customers", description: "Buyer list with phone, email, order count and SMS consent." },
};

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/** Keeps known scopes, in the canonical order; a write scope brings its read scope. */
export function normalizeScopes(raw: readonly string[]): ApiScope[] {
  const set = new Set(raw.filter(isApiScope));
  if (set.has("orders:write")) set.add("orders:read");
  if (set.has("inventory:write")) set.add("inventory:read");
  return API_SCOPES.filter((s) => set.has(s));
}

export function hasScope(scopes: readonly string[], needed: ApiScope): boolean {
  return normalizeScopes(scopes).includes(needed);
}

export const WEBHOOK_EVENTS = [
  "order.created",
  "order.paid",
  "order.fulfillment_updated",
  "order.completed",
  "order.cancelled",
  "order.refunded",
  "inventory.updated",
  "customer.created",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventName, string> = {
  "order.created": "A new order from any channel (checkout, link, POS, Shopee/Lazada import).",
  "order.paid": "Payment confirmed (GCash/Maya proof approved, PayMongo, POS, COD collected).",
  "order.fulfillment_updated": "Packed, rider booked, out for delivery, delivered, failed or returned.",
  "order.completed": "Paid and delivered — the order is done.",
  "order.cancelled": "Cancelled, expired unpaid, or voided at the register.",
  "order.refunded": "A full or partial refund was recorded.",
  "inventory.updated": "A variant's stock changed (sale, count, return, restock, import).",
  "customer.created": "A new buyer appeared in your customer list.",
};

export function isWebhookEvent(value: unknown): value is WebhookEventName {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export function normalizeEvents(raw: readonly string[]): WebhookEventName[] {
  const set = new Set(raw.filter(isWebhookEvent));
  return WEBHOOK_EVENTS.filter((e) => set.has(e));
}

export const MAX_API_TOKENS = 20;
export const MAX_WEBHOOK_ENDPOINTS = 10;
/** Failed attempts in a row (across deliveries) before an endpoint is switched off. */
export const WEBHOOK_DISABLE_AFTER = 50;
/** Minutes to wait after the Nth failed attempt. The delivery gives up after the last one (~1.6 days). */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1080] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_MINUTES.length + 1;
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** When to try again after `attempts` failures, or null to give up. */
export function nextWebhookAttempt(attempts: number, now: Date): Date | null {
  if (attempts >= WEBHOOK_MAX_ATTEMPTS) return null;
  const minutes = WEBHOOK_RETRY_MINUTES[Math.max(0, attempts - 1)] ?? WEBHOOK_RETRY_MINUTES[WEBHOOK_RETRY_MINUTES.length - 1]!;
  return new Date(now.getTime() + minutes * 60_000);
}

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|guma\.one)$/i;

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * Webhook URLs must be public HTTPS on the default port. No IP addresses, no internal names
 * and no guma.one hosts (so a webhook can't be pointed back at Guma Kart itself).
 * `allowLocal` (dev only) also accepts http://localhost and 127.0.0.1 for testing.
 */
export function validateWebhookUrl(raw: string, options: { allowLocal?: boolean } = {}): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a full URL, like https://example.com/webhooks/guma." };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const local = host === "localhost" || host === "127.0.0.1";
  if (options.allowLocal && local && (u.protocol === "http:" || u.protocol === "https:")) {
    return { ok: true, url: u.toString() };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Webhook URLs must start with https://." };
  if (u.username || u.password) return { ok: false, error: "Don't put a username or password in the URL." };
  if (u.port && u.port !== "443") return { ok: false, error: "Use the standard HTTPS port (443)." };
  if (host.includes(":") || host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host) || isPrivateIpv4(host)) {
    return { ok: false, error: "Use a domain name, not an IP address." };
  }
  if (!host.includes(".") || BLOCKED_HOST.test(host)) return { ok: false, error: "That address can't receive webhooks." };
  if (u.toString().length > 500) return { ok: false, error: "That URL is too long." };
  u.hash = "";
  return { ok: true, url: u.toString() };
}

// ─── Cursor pagination ───────────────────────────────────────────────────────

export interface ApiCursor {
  /** ISO timestamp of the last row. */
  t: string;
  /** id of the last row (tie-breaker). */
  i: string;
}

export function encodeCursor(c: ApiCursor): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(raw: string | null | undefined): ApiCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))) as Partial<ApiCursor>;
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.t))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.i)) return null;
    return { t: parsed.t, i: parsed.i };
  } catch {
    return null;
  }
}

/** 1–100, default 50. */
export function clampLimit(raw: string | number | null | undefined, fallback = 50): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(n)));
}

/** Money in API responses: a string with exactly 2 decimals ("682.30"). */
export function apiMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}
