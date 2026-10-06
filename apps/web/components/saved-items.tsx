"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import type { DemoProduct } from "@/lib/demo-data";
import { deviceId, useWishlist } from "@/lib/wishlist";
import { WishlistButton } from "@/components/wishlist-button";
import { RatingStars } from "@/components/rating-stars";

/** Phase 22: the buyer's saved items at this shop (this device, plus their Guma ID when signed in). */
export function SavedItems({ tenantSlug, products }: { tenantSlug: string; products: DemoProduct[] }) {
  const { ids, ready, mergeFromServer } = useWishlist(tenantSlug);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void fetch(`/api/wishlist?tenantSlug=${encodeURIComponent(tenantSlug)}&deviceId=${encodeURIComponent(deviceId())}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.productIds)) mergeFromServer(d.productIds);
        setSignedIn(Boolean(d.signedIn));
      })
      .catch(() => undefined);
  }, [tenantSlug, mergeFromServer]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const saved = ids.map((id) => byId.get(id)).filter((p): p is DemoProduct => Boolean(p));

  if (!ready) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (saved.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center text-neutral-500">
        <Heart className="mx-auto h-8 w-8 text-neutral-300" />
        <p className="mt-3">Nothing saved yet. Tap the heart on any item to keep it here.</p>
        <Link href={`/${tenantSlug}`} className="mt-4 inline-block font-medium text-neutral-900 underline">
          Browse the shop
        </Link>
      </div>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3" data-testid="saved-items">
        {saved.map((p) => (
          <li key={p.id} className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <Link href={`/${tenantSlug}/products/${p.slug}`} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image} alt={p.title} className="aspect-square w-full object-cover" loading="lazy" />
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-medium">{p.title}</p>
                <RatingStars rating={p.rating} className="text-neutral-500" />
                <p className="mt-1 text-sm font-semibold">₱{p.price.toLocaleString("en-PH")}</p>
                {p.preorderShipDate ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">Pre-order</p>
                ) : p.available === false ? (
                  <p className="mt-1 text-xs font-medium text-red-600">Sold out — open it to get notified</p>
                ) : null}
              </div>
            </Link>
            <WishlistButton tenantSlug={tenantSlug} productId={p.id} className="absolute right-2 top-2" />
          </li>
        ))}
      </ul>
      {!signedIn && <p className="mt-6 text-center text-xs text-neutral-500">Saved on this device. Sign in with Guma ID to keep them on any phone.</p>}
    </>
  );
}
