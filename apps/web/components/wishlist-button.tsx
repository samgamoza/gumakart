"use client";

import { Heart } from "lucide-react";
import { useWishlist } from "@/lib/wishlist";

/** Phase 22: save an item for later (works without an account). */
export function WishlistButton({
  tenantSlug,
  productId,
  size = "sm",
  withLabel = false,
  className = "",
}: {
  tenantSlug: string;
  productId: string;
  size?: "sm" | "lg";
  withLabel?: boolean;
  className?: string;
}) {
  const { ids, ready, toggle } = useWishlist(tenantSlug);
  const saved = ids.includes(productId);
  const box = size === "lg" ? "h-14 min-w-14 px-4" : "h-9 w-9";
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved items" : "Save for later"}
      disabled={!ready}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(productId);
      }}
      data-testid="wishlist-button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white text-sm font-medium text-neutral-700 shadow-sm transition hover:border-rose-300 ${box} ${className}`}
    >
      <Heart className={`h-5 w-5 ${saved ? "fill-rose-500 text-rose-500" : "text-neutral-500"}`} />
      {withLabel ? <span>{saved ? "Saved" : "Save for later"}</span> : null}
    </button>
  );
}
