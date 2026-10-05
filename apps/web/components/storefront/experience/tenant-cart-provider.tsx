"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Product } from "@/lib/store-data";
import { cartLineKey, useCart as useTenantCart } from "@/lib/cart";

export type V0CartItem = Product & { qty: number };

type TenantCartContextValue = {
  items: V0CartItem[];
  count: number;
  subtotal: number;
  isOpen: boolean;
  tenantSlug: string;
  add: (product: Product) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  openCart: () => void;
  closeCart: () => void;
};

const TenantCartContext = createContext<TenantCartContextValue | null>(null);

export function TenantCartProvider({
  tenantSlug,
  children,
}: {
  tenantSlug: string;
  children: ReactNode;
}) {
  const cart = useTenantCart(tenantSlug);
  const [isOpen, setIsOpen] = useState(false);

  const items = useMemo<V0CartItem[]>(
    () =>
      cart.items.map((item) => ({
        id: cartLineKey(item),
        name: item.variantTitle ? `${item.title} (${item.variantTitle})` : item.title,
        price: item.price,
        image: item.image,
        category: "",
        rating: 5,
        reviews: 0,
        sold: 0,
        qty: item.qty,
      })),
    [cart.items]
  );

  const add = useCallback(
    (product: Product) => {
      cart.addItem({
        productId: product.id,
        slug: product.id,
        title: product.name,
        price: product.price,
        image: product.image,
      });
      setIsOpen(true);
    },
    [cart]
  );

  const remove = useCallback(
    (id: string) => {
      cart.removeItem(id);
    },
    [cart]
  );

  const setQty = useCallback(
    (id: string, qty: number) => {
      cart.setQty(id, qty);
    },
    [cart]
  );

  const value = useMemo<TenantCartContextValue>(
    () => ({
      items,
      count: cart.count,
      subtotal: cart.subtotal,
      isOpen,
      tenantSlug,
      add,
      remove,
      setQty,
      clear: cart.clear,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    }),
    [items, cart.count, cart.subtotal, cart.clear, isOpen, tenantSlug, add, remove, setQty]
  );

  return <TenantCartContext.Provider value={value}>{children}</TenantCartContext.Provider>;
}

export function useTenantV0Cart(): TenantCartContextValue {
  const ctx = useContext(TenantCartContext);
  if (!ctx) throw new Error("useTenantV0Cart must be used within TenantCartProvider");
  return ctx;
}
