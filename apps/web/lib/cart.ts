"use client";

import { useCallback, useEffect, useState } from "react";

export interface CartItem {
  productId: string;
  slug: string;
  title: string;
  price: number;
  image: string;
  qty: number;
  /** Phase 9: the size/colour picked. Lines are keyed by variantId ?? productId. */
  variantId?: string | null;
  variantTitle?: string | null;
}

/** One cart line per product (simple) or per variant (sizes/colours). */
export function cartLineKey(item: Pick<CartItem, "productId" | "variantId">): string {
  return item.variantId ?? item.productId;
}

/**
 * Products that need a size/colour pick, per shop (productId → product slug).
 * Template "quick add" buttons only know the product, so addItem sends the buyer
 * to the product page to choose instead of adding an unpriceable line.
 */
const variantProducts = new Map<string, Map<string, string>>();

export function registerVariantProducts(tenantSlug: string, entries: Array<{ id: string; slug: string }>): void {
  variantProducts.set(tenantSlug, new Map(entries.map((e) => [e.id, e.slug])));
}

export function variantProductSlug(tenantSlug: string, productId: string): string | null {
  return variantProducts.get(tenantSlug)?.get(productId) ?? null;
}

const CART_EVENT = "guma-cart-change";

function storageKey(tenantSlug: string): string {
  return `guma-cart:${tenantSlug}`;
}

function normalizeItem(raw: unknown): CartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const productId = typeof item.productId === "string" ? item.productId : null;
  const slug = typeof item.slug === "string" ? item.slug : "";
  const title = typeof item.title === "string" ? item.title : "";
  const image = typeof item.image === "string" ? item.image : "";
  const price = Number(item.price);
  const qty = Number(item.qty);
  if (!productId || !Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(qty) || qty < 1) return null;
  const variantId = typeof item.variantId === "string" && item.variantId ? item.variantId : null;
  return {
    productId,
    variantId,
    variantTitle: variantId && typeof item.variantTitle === "string" ? item.variantTitle : null,
    slug,
    title,
    image,
    price,
    qty: Math.min(Math.floor(qty), 99),
  };
}

function readCart(tenantSlug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tenantSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeItem).filter((item): item is CartItem => item !== null);
  } catch {
    return [];
  }
}

function writeCart(tenantSlug: string, items: CartItem[]): void {
  try {
    window.localStorage.setItem(storageKey(tenantSlug), JSON.stringify(items));
  } catch {
    // Private mode / quota — still update in-memory via the event below.
  }
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { tenantSlug, items } }));
}

export function useCart(tenantSlug: string) {
  const [items, setItems] = useState<CartItem[]>([]);
  // Cart loads after mount (localStorage), so consumers can avoid hydration mismatch.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(readCart(tenantSlug));
    setReady(true);

    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantSlug?: string; items?: CartItem[] }>).detail;
      if (detail?.tenantSlug && detail.tenantSlug !== tenantSlug) return;
      if (detail?.items && Array.isArray(detail.items)) {
        setItems(detail.items);
        return;
      }
      setItems(readCart(tenantSlug));
    };
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [tenantSlug]);

  const addItem = useCallback(
    (item: Omit<CartItem, "qty">, qty = 1) => {
      const price = Number(item.price);
      if (!item.productId || !Number.isFinite(price)) return;

      if (!item.variantId) {
        const slug = variantProductSlug(tenantSlug, item.productId);
        if (slug) {
          window.location.assign(`/${tenantSlug}/products/${encodeURIComponent(slug)}?pick=1`);
          return;
        }
      }

      const normalized = {
        ...item,
        price,
        image: item.image || "",
        slug: item.slug || "",
        title: item.title || "Product",
      };

      const current = readCart(tenantSlug);
      const key = cartLineKey(normalized);
      const existing = current.find((entry) => cartLineKey(entry) === key);
      const next = existing
        ? current.map((entry) =>
            cartLineKey(entry) === key
              ? { ...entry, qty: Math.min(entry.qty + qty, 99) }
              : entry
          )
        : [...current, { ...normalized, qty: Math.min(Math.max(1, qty), 99) }];

      // Optimistic UI update — don't wait only on the CustomEvent round-trip.
      setItems(next);
      writeCart(tenantSlug, next);
    },
    [tenantSlug]
  );

  const setQty = useCallback(
    (lineKey: string, qty: number) => {
      const current = readCart(tenantSlug);
      // Callers pass cartLineKey(item); older callers pass a productId — then the
      // first line of that product is meant.
      const target =
        current.find((entry) => cartLineKey(entry) === lineKey) ??
        current.find((entry) => entry.productId === lineKey);
      if (!target) return;
      const next =
        qty <= 0
          ? current.filter((entry) => entry !== target)
          : current.map((entry) => (entry === target ? { ...entry, qty: Math.min(qty, 99) } : entry));
      setItems(next);
      writeCart(tenantSlug, next);
    },
    [tenantSlug]
  );

  const removeItem = useCallback(
    (lineKey: string) => setQty(lineKey, 0),
    [setQty]
  );

  const clear = useCallback(() => {
    setItems([]);
    writeCart(tenantSlug, []);
  }, [tenantSlug]);

  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  return { items, ready, addItem, setQty, removeItem, clear, count, subtotal };
}
