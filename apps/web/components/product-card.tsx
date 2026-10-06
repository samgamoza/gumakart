"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoProduct } from "@/lib/demo-data";
import { RatingStars } from "@/components/rating-stars";
import { WishlistButton } from "@/components/wishlist-button";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function ProductCard({
  tenantSlug,
  product,
}: {
  tenantSlug: string;
  product: DemoProduct;
}) {
  return (
    <Link href={`/${tenantSlug}/products/${product.slug}`} className="group block">
      <article className="flex gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card p-3 shadow-sm transition hover:border-primary/20 hover:shadow-md hover:shadow-primary/5">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl">
          <Image
            src={product.image}
            alt={product.title}
            fill
            className="object-cover transition duration-300 group-hover:scale-105"
            sizes="96px"
          />
          {product.compareAtPrice && (
            <Badge className="absolute left-1 top-1 px-1.5 py-0 text-[10px]">Sale</Badge>
          )}
          <WishlistButton tenantSlug={tenantSlug} productId={product.id} className="absolute bottom-1 right-1 !h-7 !w-7" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div>
            <h3 className="font-semibold leading-snug text-foreground group-hover:text-primary">
              {product.title}
            </h3>
            <RatingStars rating={product.rating} className="mt-0.5 text-muted-foreground" />
            {product.preorderShipDate ? (
              <span className="mt-0.5 block text-[11px] font-medium text-amber-700">Pre-order</span>
            ) : product.available === false ? (
              <span className="mt-0.5 block text-[11px] font-medium text-red-600">Sold out</span>
            ) : null}
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {product.shortDescription}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-primary">{formatPrice(product.price)}</span>
              {product.compareAtPrice && (
                <span className="text-xs text-muted-foreground line-through">
                  {formatPrice(product.compareAtPrice)}
                </span>
              )}
            </div>
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 shrink-0 rounded-lg"
              onClick={(e) => e.preventDefault()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </article>
    </Link>
  );
}
