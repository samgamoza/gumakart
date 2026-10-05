"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

/** Sticky checkout strip for Sarab (and similar) storefronts that don't use ShopShell. */
export function StorefrontCartBar({
  tenantSlug,
  accent,
}: {
  tenantSlug: string;
  accent: string;
}) {
  const { count, subtotal, ready } = useCart(tenantSlug);

  if (!ready || count <= 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] border-t border-black/10 bg-white/95 p-4 backdrop-blur-md safe-bottom">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-500">{count} in cart</p>
          <p className="text-lg font-bold text-neutral-900">{formatPrice(subtotal)}</p>
        </div>
        <Link
          href={`/${tenantSlug}/checkout`}
          className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
          style={{ backgroundColor: accent, boxShadow: `0 8px 20px -6px ${accent}66` }}
        >
          <ShoppingBag className="h-4 w-4" />
          Checkout
        </Link>
      </div>
    </div>
  );
}
