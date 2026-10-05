"use client";

/**
 * Phase 12b — POS offline mode (device side).
 *
 * Everything lives in this browser's localStorage, namespaced per shop:
 *  - `state` / `products`: the last register state and product list, so the screen opens
 *    and sells without internet (prices and stock as of the last sync);
 *  - `outbox`: sales rung offline, each with its idempotency key and full request body.
 *    They're sent in order to the normal sale endpoint when the internet is back; a sale
 *    that already reached the server comes back as a duplicate, never a second sale;
 *  - `block`: BIR on — this device's reserved invoice numbers and the next one to use.
 *
 * Storage can be unavailable (private mode, blocked site data): every access is wrapped,
 * and the register then simply needs internet as before.
 */

const DEVICE_KEY = "gk-pos-device";
const LAST_SHOP_KEY = "gk-pos-last-shop";
/** Warn the cashier well before storage could fill up. */
export const OUTBOX_WARN_AT = 300;

function read<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const ns = (shop: string, part: string) => `gk-pos:${shop}:${part}`;

/** A stable random id for this browser (sent with offline sales and invoice blocks). */
export function deviceId(): string {
  const existing = read<string>(DEVICE_KEY);
  if (existing && /^[A-Za-z0-9_-]{8,40}$/.test(existing)) return existing;
  const c = globalThis.crypto as Crypto | undefined;
  const id = `d${(c?.randomUUID ? c.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
  write(DEVICE_KEY, id);
  return id;
}

export function storageWorks(): boolean {
  return write("gk-pos-probe", 1) && write("gk-pos-probe", null);
}

// ─── Cached register state ───────────────────────────────────────────────────

export function lastShop(): string | null {
  return read<string>(LAST_SHOP_KEY);
}

export function cacheRegister<S, P>(shop: string, state: S, products?: P[]): void {
  write(LAST_SHOP_KEY, shop);
  write(ns(shop, "state"), { savedAt: new Date().toISOString(), state });
  if (products) write(ns(shop, "products"), products);
}

export function cachedState<S>(shop: string): { savedAt: string; state: S } | null {
  return read(ns(shop, "state"));
}

export function cacheProducts<P>(shop: string, products: P[]): void {
  write(ns(shop, "products"), products);
}

export function cachedProducts<P>(shop: string): P[] | null {
  return read<P[]>(ns(shop, "products"));
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

export interface QueuedSale<R = unknown> {
  key: string;
  /** Exactly what POST /api/pos/sales gets (with `offline`). */
  body: Record<string, unknown>;
  /** The receipt printed at the counter. */
  receipt: R;
  queuedAt: string;
  attempts: number;
  lastError?: string | null;
}

export function outbox<R>(shop: string): QueuedSale<R>[] {
  return read<QueuedSale<R>[]>(ns(shop, "outbox")) ?? [];
}

/** Adds a sale; returns false when the device couldn't store it (the caller must not print it as saved). */
export function enqueue<R>(shop: string, sale: QueuedSale<R>): boolean {
  const list = outbox<R>(shop);
  if (list.some((s) => s.key === sale.key)) return true;
  return write(ns(shop, "outbox"), [...list, sale]);
}

function removeFromOutbox(shop: string, key: string) {
  write(
    ns(shop, "outbox"),
    outbox(shop).filter((s) => s.key !== key)
  );
}

function markAttempt(shop: string, key: string, error: string | null) {
  write(
    ns(shop, "outbox"),
    outbox(shop).map((s) => (s.key === key ? { ...s, attempts: s.attempts + 1, lastError: error } : s))
  );
}

export type SyncStop = "done" | "offline" | "locked" | "busy" | "error";

export interface SyncResult {
  synced: number;
  /** Saved by the server as "needs a look" instead of a sale (kept whole for the owner). */
  parked: number;
  /** Synced with issues filed (stock short, price changed, …). */
  flagged: number;
  remaining: number;
  stop: SyncStop;
  /** Receipts the server returned, keyed by the offline key (to swap in real order numbers). */
  receipts: Record<string, unknown>;
}

let syncing = false;

/**
 * Sends waiting sales one by one, oldest first. Stops at the first network failure (still
 * offline), when the register is locked (needs a PIN, sales stay queued), or on a server
 * error (retried next round). Safe to call often — only one run at a time.
 */
export async function syncOutbox(shop: string, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, parked: 0, flagged: 0, remaining: outbox(shop).length, stop: "done", receipts: {} };
  if (syncing) return { ...result, stop: "busy" };
  syncing = true;
  try {
    for (const sale of outbox(shop)) {
      let res: Response;
      try {
        res = await fetchImpl("/api/pos/sales", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sale.body),
        });
      } catch {
        result.stop = "offline";
        break;
      }
      let data: { ok?: boolean; parked?: boolean; error?: string; code?: string; receipt?: { syncIssues?: number } } = {};
      try {
        data = await res.json();
      } catch {
        // A proxy/HTML error page: treat like no connection.
        result.stop = res.status >= 500 ? "offline" : "error";
        markAttempt(shop, sale.key, `HTTP ${res.status}`);
        break;
      }
      if (res.ok && data.ok) {
        removeFromOutbox(shop, sale.key);
        if (data.parked) result.parked += 1;
        else {
          result.synced += 1;
          if (data.receipt) result.receipts[sale.key] = data.receipt;
          if (data.receipt?.syncIssues) result.flagged += 1;
        }
        continue;
      }
      if (res.status === 401 || data.code === "POS_LOCKED") {
        result.stop = "locked";
        break;
      }
      markAttempt(shop, sale.key, data.error ?? `HTTP ${res.status}`);
      result.stop = res.status >= 500 || res.status === 429 ? "offline" : "error";
      break;
    }
  } finally {
    syncing = false;
  }
  result.remaining = outbox(shop).length;
  return result;
}

// ─── BIR invoice block ───────────────────────────────────────────────────────

export interface DeviceBlock {
  id: string;
  prefix: string;
  startNo: number;
  endNo: number;
  /** Next number this device will print offline. */
  next: number;
}

export function formatInvoice(prefix: string, n: number): string {
  return `${prefix.trim().toUpperCase().slice(0, 12)}${String(n).padStart(10, "0")}`;
}

export function deviceBlock(shop: string): DeviceBlock | null {
  return read<DeviceBlock>(ns(shop, "block"));
}

export function blockRemaining(block: DeviceBlock | null): number {
  return block ? Math.max(block.endNo - block.next + 1, 0) : 0;
}

/**
 * Keeps a block on the device while online. A new block replaces the old one only when
 * it's used up (or the shop changed its invoice prefix), so numbers are never skipped.
 */
export async function ensureBlock(shop: string, prefix: string, fetchImpl: typeof fetch = fetch, retried = false): Promise<DeviceBlock | null> {
  const current = deviceBlock(shop);
  const usable = current && current.prefix === prefix.trim().toUpperCase().slice(0, 12) && blockRemaining(current) > 0;
  if (usable) return current;
  try {
    const res = await fetchImpl("/api/pos/offline/block", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), replaceBlockId: current && blockRemaining(current) === 0 ? current.id : null }),
    });
    const data = (await res.json()) as { ok: boolean; block?: { id: string; prefix: string; startNo: number; endNo: number; nextFree?: number } };
    if (!data.ok || !data.block) return current;
    const b = data.block;
    // Same block as before: keep our position in it, but never behind what the server has
    // already seen used (this browser's storage may have been cleared).
    const next = Math.max(current && current.id === b.id ? current.next : b.startNo, b.nextFree ?? b.startNo);
    const block: DeviceBlock = { id: b.id, prefix: b.prefix, startNo: b.startNo, endNo: b.endNo, next };
    write(ns(shop, "block"), block);
    // The server says it's all used already: ask once more for the next block.
    if (blockRemaining(block) === 0 && !retried) return ensureBlock(shop, prefix, fetchImpl, true);
    return block;
  } catch {
    return current;
  }
}

/** Takes the next offline invoice number, or null when the block is used up (or there is none). */
export function takeInvoiceNumber(shop: string): string | null {
  const block = deviceBlock(shop);
  if (!block || blockRemaining(block) <= 0) return null;
  const number = formatInvoice(block.prefix, block.next);
  if (!write(ns(shop, "block"), { ...block, next: block.next + 1 })) return null;
  return number;
}

/** BIR off now: forget the block (its unused numbers can be released in Settings). */
export function clearBlock(shop: string): void {
  write(ns(shop, "block"), null);
}
