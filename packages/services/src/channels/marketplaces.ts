/**
 * Phase 13 — Shopee and Lazada (Philippines). READY TO HOOK UP.
 *
 * One stock pool: Guma Kart's variant stock is the truth. Linked marketplace listings get
 * their stock pushed from it, and paid marketplace orders are imported (taking stock here),
 * so the same unit can't be sold twice across channels — within the sync interval.
 *
 * Turns on with:
 *  - Shopee Open Platform: SHOPEE_PARTNER_ID + SHOPEE_PARTNER_KEY (v2 API, HMAC-SHA256 sign)
 *  - Lazada Open Platform: LAZADA_APP_KEY + LAZADA_APP_SECRET (HMAC-SHA256 sign)
 * Until then: production shows "Malapit na"; local/dev can connect a demo shop whose
 * listings mirror the catalog and whose stock pushes are recorded as mocks.
 *
 * Endpoints/fields follow the public docs as of 2026; check them against the partner
 * console when the apps are approved (the first real sync should be watched).
 */

import { allowIntegrationMocks } from "../config/runtime-mode";

export type MarketplacePlatformId = "shopee" | "lazada";

export interface MarketplaceItem {
  externalItemId: string;
  /** Shopee model id / Lazada SkuId; "" when the item has no variations. */
  externalModelId: string;
  sku: string | null;
  title: string;
  price: number | null;
  stock: number | null;
}

export type MarketplaceOrderStatus = "unpaid" | "to_ship" | "shipped" | "completed" | "cancelled" | "returned";

export interface MarketplaceOrderLine {
  externalItemId: string;
  externalModelId: string;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface MarketplaceOrder {
  externalOrderId: string;
  status: MarketplaceOrderStatus;
  buyerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  total: number;
  items: MarketplaceOrderLine[];
}

export interface MarketplaceTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface MarketplaceClient {
  platform: MarketplacePlatformId;
  listItems(): Promise<MarketplaceItem[]>;
  updateStock(updates: Array<{ externalItemId: string; externalModelId: string; stock: number }>): Promise<{ ok: string[]; failed: Array<{ key: string; error: string }> }>;
  /** Orders created or changed since `since`. */
  listOrders(since: Date): Promise<MarketplaceOrder[]>;
}

export class MarketplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export function listingKey(itemId: string, modelId: string): string {
  return `${itemId}:${modelId}`;
}

export function marketplaceConfigured(platform: MarketplacePlatformId): boolean {
  if (platform === "shopee") return Boolean(process.env.SHOPEE_PARTNER_ID?.trim() && process.env.SHOPEE_PARTNER_KEY?.trim());
  return Boolean(process.env.LAZADA_APP_KEY?.trim() && process.env.LAZADA_APP_SECRET?.trim());
}

export function marketplaceMode(platform: MarketplacePlatformId): "live" | "demo" | "off" {
  if (marketplaceConfigured(platform)) return "live";
  return allowIntegrationMocks() ? "demo" : "off";
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Shopee (Open Platform v2) ───────────────────────────────────────────────

const SHOPEE_HOST = () => process.env.SHOPEE_API_HOST?.trim() || "https://partner.shopeemobile.com";

/** Shopee sign: HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]). */
export async function shopeeSign(partnerKey: string, parts: Array<string | number>): Promise<string> {
  return hmacHex(partnerKey, parts.join(""));
}

export async function shopeeAuthUrl(redirect: string, now = Date.now()): Promise<string> {
  const partnerId = process.env.SHOPEE_PARTNER_ID ?? "";
  const path = "/api/v2/shop/auth_partner";
  const ts = Math.floor(now / 1000);
  const sign = await shopeeSign(process.env.SHOPEE_PARTNER_KEY ?? "", [partnerId, path, ts]);
  const u = new URL(`${SHOPEE_HOST()}${path}`);
  u.searchParams.set("partner_id", partnerId);
  u.searchParams.set("timestamp", String(ts));
  u.searchParams.set("sign", sign);
  u.searchParams.set("redirect", redirect);
  return u.toString();
}

async function shopeeCall<T>(path: string, opts: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown; shop?: { shopId: string; accessToken: string } }): Promise<T> {
  const partnerId = process.env.SHOPEE_PARTNER_ID ?? "";
  const ts = Math.floor(Date.now() / 1000);
  const parts: Array<string | number> = [partnerId, path, ts];
  if (opts.shop) parts.push(opts.shop.accessToken, opts.shop.shopId);
  const sign = await shopeeSign(process.env.SHOPEE_PARTNER_KEY ?? "", parts);
  const u = new URL(`${SHOPEE_HOST()}${path}`);
  u.searchParams.set("partner_id", partnerId);
  u.searchParams.set("timestamp", String(ts));
  u.searchParams.set("sign", sign);
  if (opts.shop) {
    u.searchParams.set("access_token", opts.shop.accessToken);
    u.searchParams.set("shop_id", opts.shop.shopId);
  }
  for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok || (data.error && data.error !== "")) throw new MarketplaceError(`Shopee: ${data.message || data.error || res.status}`);
  return data;
}

export async function shopeeExchangeCode(code: string, shopId: string): Promise<MarketplaceTokens> {
  const data = await shopeeCall<{ access_token: string; refresh_token: string; expire_in: number }>("/api/v2/auth/token/get", {
    method: "POST",
    body: { code, shop_id: Number(shopId), partner_id: Number(process.env.SHOPEE_PARTNER_ID) },
  });
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expire_in * 1000) };
}

export async function shopeeRefresh(refreshToken: string, shopId: string): Promise<MarketplaceTokens> {
  const data = await shopeeCall<{ access_token: string; refresh_token: string; expire_in: number }>("/api/v2/auth/access_token/get", {
    method: "POST",
    body: { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(process.env.SHOPEE_PARTNER_ID) },
  });
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + data.expire_in * 1000) };
}

const SHOPEE_STATUS: Record<string, MarketplaceOrderStatus> = {
  UNPAID: "unpaid",
  READY_TO_SHIP: "to_ship",
  PROCESSED: "to_ship",
  RETRY_SHIP: "to_ship",
  SHIPPED: "shipped",
  TO_CONFIRM_RECEIVE: "shipped",
  COMPLETED: "completed",
  IN_CANCEL: "to_ship",
  CANCELLED: "cancelled",
  TO_RETURN: "returned",
};

export function shopeeClient(shop: { shopId: string; accessToken: string }): MarketplaceClient {
  return {
    platform: "shopee",
    async listItems() {
      const out: MarketplaceItem[] = [];
      for (let offset = 0; offset < 2000; offset += 100) {
        const list = await shopeeCall<{ response?: { item?: Array<{ item_id: number }>; has_next_page?: boolean } }>("/api/v2/product/get_item_list", {
          shop,
          query: { offset: String(offset), page_size: "100", item_status: "NORMAL" },
        });
        const ids = (list.response?.item ?? []).map((i) => i.item_id);
        if (ids.length === 0) break;
        const info = await shopeeCall<{ response?: { item_list?: Array<{ item_id: number; item_name: string; item_sku?: string; has_model?: boolean; price_info?: Array<{ current_price: number }>; stock_info_v2?: { summary_info?: { total_available_stock?: number } } }> } }>(
          "/api/v2/product/get_item_base_info",
          { shop, query: { item_id_list: ids.join(",") } }
        );
        for (const item of info.response?.item_list ?? []) {
          if (!item.has_model) {
            out.push({
              externalItemId: String(item.item_id),
              externalModelId: "",
              sku: item.item_sku || null,
              title: item.item_name,
              price: item.price_info?.[0]?.current_price ?? null,
              stock: item.stock_info_v2?.summary_info?.total_available_stock ?? null,
            });
            continue;
          }
          const models = await shopeeCall<{ response?: { tier_variation?: Array<{ option_list?: Array<{ option: string }> }>; model?: Array<{ model_id: number; model_sku?: string; tier_index?: number[]; price_info?: Array<{ current_price: number }>; stock_info_v2?: { summary_info?: { total_available_stock?: number } } }> } }>(
            "/api/v2/product/get_model_list",
            { shop, query: { item_id: String(item.item_id) } }
          );
          const tiers = models.response?.tier_variation ?? [];
          for (const m of models.response?.model ?? []) {
            const label = (m.tier_index ?? []).map((idx, t) => tiers[t]?.option_list?.[idx]?.option).filter(Boolean).join(" / ");
            out.push({
              externalItemId: String(item.item_id),
              externalModelId: String(m.model_id),
              sku: m.model_sku || null,
              title: label ? `${item.item_name} (${label})` : item.item_name,
              price: m.price_info?.[0]?.current_price ?? null,
              stock: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
            });
          }
        }
        if (!list.response?.has_next_page) break;
      }
      return out;
    },
    async updateStock(updates) {
      const ok: string[] = [];
      const failed: Array<{ key: string; error: string }> = [];
      const byItem = new Map<string, typeof updates>();
      for (const u of updates) byItem.set(u.externalItemId, [...(byItem.get(u.externalItemId) ?? []), u]);
      for (const [itemId, list] of byItem) {
        try {
          await shopeeCall("/api/v2/product/update_stock", {
            shop,
            method: "POST",
            body: {
              item_id: Number(itemId),
              stock_list: list.map((u) => ({ ...(u.externalModelId ? { model_id: Number(u.externalModelId) } : { model_id: 0 }), seller_stock: [{ stock: Math.max(0, u.stock) }] })),
            },
          });
          ok.push(...list.map((u) => listingKey(u.externalItemId, u.externalModelId)));
        } catch (error) {
          for (const u of list) failed.push({ key: listingKey(u.externalItemId, u.externalModelId), error: error instanceof Error ? error.message : "failed" });
        }
      }
      return { ok, failed };
    },
    async listOrders(since) {
      const from = Math.floor(since.getTime() / 1000);
      const to = Math.floor(Date.now() / 1000);
      const sns: string[] = [];
      let cursor = "";
      for (let page = 0; page < 20; page++) {
        const list = await shopeeCall<{ response?: { order_list?: Array<{ order_sn: string }>; more?: boolean; next_cursor?: string } }>("/api/v2/order/get_order_list", {
          shop,
          query: { time_range_field: "update_time", time_from: String(from), time_to: String(Math.min(to, from + 15 * 86400)), page_size: "100", cursor },
        });
        sns.push(...(list.response?.order_list ?? []).map((o) => o.order_sn));
        if (!list.response?.more) break;
        cursor = list.response.next_cursor ?? "";
      }
      const out: MarketplaceOrder[] = [];
      for (let i = 0; i < sns.length; i += 50) {
        const detail = await shopeeCall<{ response?: { order_list?: Array<{ order_sn: string; order_status: string; buyer_username?: string; create_time: number; update_time: number; total_amount: number; item_list?: Array<{ item_id: number; model_id: number; item_sku?: string; model_sku?: string; item_name: string; model_name?: string; model_quantity_purchased: number; model_discounted_price: number }> }> } }>(
          "/api/v2/order/get_order_detail",
          { shop, query: { order_sn_list: sns.slice(i, i + 50).join(","), response_optional_fields: "buyer_username,item_list,total_amount" } }
        );
        for (const o of detail.response?.order_list ?? []) {
          out.push({
            externalOrderId: o.order_sn,
            status: SHOPEE_STATUS[o.order_status] ?? "to_ship",
            buyerName: o.buyer_username ?? null,
            createdAt: new Date(o.create_time * 1000),
            updatedAt: new Date(o.update_time * 1000),
            total: o.total_amount,
            items: (o.item_list ?? []).map((l) => ({
              externalItemId: String(l.item_id),
              externalModelId: l.model_id ? String(l.model_id) : "",
              sku: l.model_sku || l.item_sku || null,
              title: l.model_name ? `${l.item_name} (${l.model_name})` : l.item_name,
              quantity: l.model_quantity_purchased,
              unitPrice: l.model_discounted_price,
            })),
          });
        }
      }
      return out;
    },
  };
}

// ─── Lazada (Open Platform) ──────────────────────────────────────────────────

const LAZADA_API = () => process.env.LAZADA_API_HOST?.trim() || "https://api.lazada.com.ph/rest";
const LAZADA_AUTH = "https://auth.lazada.com/rest";

/** Lazada sign: uppercase HMAC-SHA256(app secret, apiPath + sorted key+value pairs). */
export async function lazadaSign(secret: string, apiPath: string, params: Record<string, string>): Promise<string> {
  const base = apiPath + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  return (await hmacHex(secret, base)).toUpperCase();
}

export function lazadaAuthUrl(redirect: string, state: string): string {
  const u = new URL("https://auth.lazada.com/oauth/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("force_auth", "true");
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("client_id", process.env.LAZADA_APP_KEY ?? "");
  u.searchParams.set("state", state);
  return u.toString();
}

async function lazadaCall<T>(host: string, apiPath: string, params: Record<string, string>, accessToken?: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const all: Record<string, string> = {
    ...params,
    app_key: process.env.LAZADA_APP_KEY ?? "",
    sign_method: "sha256",
    timestamp: String(Date.now()),
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  all.sign = await lazadaSign(process.env.LAZADA_APP_SECRET ?? "", apiPath, all);
  const u = new URL(`${host}${apiPath}`);
  let body: string | undefined;
  if (method === "GET") for (const [k, v] of Object.entries(all)) u.searchParams.set(k, v);
  else body = new URLSearchParams(all).toString();
  const res = await fetch(u.toString(), { method, headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined, body });
  const data = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!res.ok || (data.code && data.code !== "0")) throw new MarketplaceError(`Lazada: ${data.message || data.code || res.status}`);
  return data;
}

export async function lazadaExchangeCode(code: string): Promise<MarketplaceTokens & { sellerId: string; name: string | null }> {
  const d = await lazadaCall<{ access_token: string; refresh_token: string; expires_in: number; country_user_info?: Array<{ country: string; seller_id: string; short_code?: string }>; account?: string }>(
    LAZADA_AUTH,
    "/auth/token/create",
    { code }
  );
  const ph = d.country_user_info?.find((c) => c.country?.toLowerCase() === "ph") ?? d.country_user_info?.[0];
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: new Date(Date.now() + d.expires_in * 1000), sellerId: ph?.seller_id ?? "", name: d.account ?? ph?.short_code ?? null };
}

export async function lazadaRefresh(refreshToken: string): Promise<MarketplaceTokens> {
  const d = await lazadaCall<{ access_token: string; refresh_token: string; expires_in: number }>(LAZADA_AUTH, "/auth/token/refresh", { refresh_token: refreshToken });
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: new Date(Date.now() + d.expires_in * 1000) };
}

const LAZADA_STATUS: Record<string, MarketplaceOrderStatus> = {
  unpaid: "unpaid",
  pending: "to_ship",
  packed: "to_ship",
  ready_to_ship: "to_ship",
  shipped: "shipped",
  delivered: "completed",
  confirmed: "completed",
  canceled: "cancelled",
  returned: "returned",
  failed: "cancelled",
};

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function lazadaClient(shop: { accessToken: string }): MarketplaceClient {
  return {
    platform: "lazada",
    async listItems() {
      const out: MarketplaceItem[] = [];
      for (let offset = 0; offset < 2000; offset += 50) {
        const d = await lazadaCall<{ data?: { products?: Array<{ item_id: number; attributes?: { name?: string }; skus?: Array<{ SkuId: number; SellerSku?: string; quantity?: number; price?: number; Status?: string }> }> } }>(
          LAZADA_API(),
          "/products/get",
          { filter: "live", offset: String(offset), limit: "50" },
          shop.accessToken
        );
        const products = d.data?.products ?? [];
        for (const p of products) {
          for (const s of p.skus ?? []) {
            out.push({
              externalItemId: String(p.item_id),
              externalModelId: String(s.SkuId),
              sku: s.SellerSku || null,
              title: p.attributes?.name ?? s.SellerSku ?? String(p.item_id),
              price: s.price ?? null,
              stock: s.quantity ?? null,
            });
          }
        }
        if (products.length < 50) break;
      }
      return out;
    },
    async updateStock(updates) {
      const ok: string[] = [];
      const failed: Array<{ key: string; error: string }> = [];
      for (let i = 0; i < updates.length; i += 20) {
        const batch = updates.slice(i, i + 20);
        const payload = `<?xml version="1.0" encoding="UTF-8" ?><Request><Product><Skus>${batch
          .map((u) => `<Sku><ItemId>${xmlEscape(u.externalItemId)}</ItemId><SkuId>${xmlEscape(u.externalModelId)}</SkuId><SellableQuantity>${Math.max(0, u.stock)}</SellableQuantity></Sku>`)
          .join("")}</Skus></Product></Request>`;
        try {
          await lazadaCall(LAZADA_API(), "/product/stock/sellable/update", { payload }, shop.accessToken, "POST");
          ok.push(...batch.map((u) => listingKey(u.externalItemId, u.externalModelId)));
        } catch (error) {
          for (const u of batch) failed.push({ key: listingKey(u.externalItemId, u.externalModelId), error: error instanceof Error ? error.message : "failed" });
        }
      }
      return { ok, failed };
    },
    async listOrders(since) {
      const d = await lazadaCall<{ data?: { orders?: Array<{ order_id: number; statuses?: string[]; customer_first_name?: string; customer_last_name?: string; created_at: string; updated_at: string; price: string }> } }>(
        LAZADA_API(),
        "/orders/get",
        { update_after: since.toISOString(), sort_by: "updated_at", sort_direction: "ASC", limit: "100" },
        shop.accessToken
      );
      const out: MarketplaceOrder[] = [];
      for (const o of d.data?.orders ?? []) {
        const items = await lazadaCall<{ data?: Array<{ product_id?: number; sku_id?: number; sku?: string; name: string; item_price: number; paid_price?: number }> }>(
          LAZADA_API(),
          "/order/items/get",
          { order_id: String(o.order_id) },
          shop.accessToken
        );
        // Lazada returns one row per unit: group them.
        const lines = new Map<string, MarketplaceOrderLine>();
        for (const it of items.data ?? []) {
          const key = `${it.product_id ?? ""}:${it.sku_id ?? ""}`;
          const prev = lines.get(key);
          if (prev) prev.quantity += 1;
          else lines.set(key, { externalItemId: String(it.product_id ?? ""), externalModelId: String(it.sku_id ?? ""), sku: it.sku ?? null, title: it.name, quantity: 1, unitPrice: it.paid_price ?? it.item_price });
        }
        const status = (o.statuses ?? [])[0] ?? "pending";
        out.push({
          externalOrderId: String(o.order_id),
          status: LAZADA_STATUS[status] ?? "to_ship",
          buyerName: [o.customer_first_name, o.customer_last_name].filter(Boolean).join(" ") || null,
          createdAt: new Date(o.created_at),
          updatedAt: new Date(o.updated_at),
          total: Number(o.price),
          items: [...lines.values()],
        });
      }
      return out;
    },
  };
}

/** Demo (local/dev): accepts every stock push, returns no orders (simulate them instead). */
export function demoMarketplaceClient(platform: MarketplacePlatformId): MarketplaceClient {
  return {
    platform,
    async listItems() {
      return [];
    },
    async updateStock(updates) {
      return { ok: updates.map((u) => listingKey(u.externalItemId, u.externalModelId)), failed: [] };
    },
    async listOrders() {
      return [];
    },
  };
}
