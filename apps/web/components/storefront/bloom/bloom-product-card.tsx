"use client";

import Image from "next/image";
import Link from "next/link";
import { Check, Eye, ShoppingCart } from "lucide-react";
import { useState } from "react";
import type { DemoProduct } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function BloomProductCard({
  tenantSlug,
  product,
  primary,
}: {
  tenantSlug: string;
  product: DemoProduct;
  primary: string;
}) {
  const { addItem, ready } = useCart(tenantSlug);
  const [imageError, setImageError] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const productHref = `/${tenantSlug}/products/${product.slug}`;

  async function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsAdding(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      image: product.image,
    });
    setIsAdding(false);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2000);
  }

  return (
    <article className="bloom-card group">
      <div className="relative overflow-hidden">
        <Link href={productHref} className="relative block">
          <div className="aspect-square overflow-hidden bg-muted">
            {!imageError ? (
              <Image
                src={product.image}
                alt={product.title}
                width={400}
                height={400}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                Image not available
              </div>
            )}
          </div>
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <span
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white"
              style={{ background: primary }}
            >
              <Eye className="h-4 w-4" />
              View product
            </span>
          </div>
        </Link>
      </div>

      <div className="space-y-3 p-4">
        <Link href={productHref}>
          <h2 className="line-clamp-2 font-semibold transition hover:opacity-80">{product.title}</h2>
        </Link>
        <p className="text-lg font-bold">{formatPrice(product.price)}</p>
        <button
          type="button"
          className={`bloom-btn-primary ${justAdded ? "bloom-added" : ""}`}
          onClick={handleAddToCart}
          disabled={!ready || isAdding}
        >
          {isAdding ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Adding...
            </>
          ) : justAdded ? (
            <>
              <Check className="h-4 w-4" />
              Added to cart!
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              Add to cart
            </>
          )}
        </button>
      </div>
    </article>
  );
}
