"use client";

import Link from "next/link";
import Image from "next/image";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DemoProduct } from "@/lib/demo-data";
import type { ResolvedShopTheme } from "@gumakart/storefront-themes";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function ThemedProductCard({
  tenantSlug,
  product,
  theme,
}: {
  tenantSlug: string;
  product: DemoProduct;
  theme: ResolvedShopTheme;
}) {
  if (theme.card === "magazine" || theme.card === "grid") {
    return (
      <Link href={`/${tenantSlug}/products/${product.slug}`} className="group block">
        <article
          className="overflow-hidden transition hover:scale-[1.01]"
          style={{
            borderRadius: theme.radius,
            backgroundColor: theme.cardBackground,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div className="relative aspect-[4/5] w-full overflow-hidden">
            <Image src={product.image} alt={product.title} fill className="object-cover" sizes="240px" />
          </div>
          <div className="p-3">
            <h3 className="font-semibold leading-snug">{product.title}</h3>
            <p className="mt-2 font-bold" style={{ color: theme.primaryColor }}>
              {formatPrice(product.price)}
            </p>
          </div>
        </article>
      </Link>
    );
  }

  if (theme.card === "brutal") {
    return (
      <Link href={`/${tenantSlug}/products/${product.slug}`} className="group block">
        <article
          className="flex gap-3 border-4 p-3 shadow-[4px_4px_0_0_currentColor]"
          style={{
            borderRadius: theme.radius,
            borderColor: theme.foreground,
            backgroundColor: theme.cardBackground,
            color: theme.foreground,
          }}
        >
          <div className="relative h-24 w-24 shrink-0 overflow-hidden border-2" style={{ borderColor: theme.foreground }}>
            <Image src={product.image} alt={product.title} fill className="object-cover" sizes="96px" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div>
              <h3 className="font-black leading-snug">{product.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs opacity-70">{product.shortDescription}</p>
            </div>
            <p className="font-black" style={{ color: theme.primaryColor }}>
              {formatPrice(product.price)}
            </p>
          </div>
        </article>
      </Link>
    );
  }

  if (theme.card === "glass-tile") {
    return (
      <Link href={`/${tenantSlug}/products/${product.slug}`} className="group block">
        <article
          className="flex gap-3 p-3 backdrop-blur-md transition hover:scale-[1.01]"
          style={{
            borderRadius: theme.radius,
            backgroundColor: theme.cardBackground,
            border: `1px solid ${theme.border}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
          }}
        >
          <div className="relative h-24 w-24 shrink-0 overflow-hidden" style={{ borderRadius: theme.radius }}>
            <Image src={product.image} alt={product.title} fill className="object-cover" sizes="96px" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
            <div>
              <h3 className="font-semibold leading-snug">{product.title}</h3>
              <p className="mt-0.5 line-clamp-2 text-xs opacity-70">{product.shortDescription}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold" style={{ color: theme.primaryColor }}>
                {formatPrice(product.price)}
              </span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 shrink-0"
                style={{ borderRadius: theme.radius }}
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

  return (
    <Link href={`/${tenantSlug}/products/${product.slug}`} className="group block">
      <article
        className="flex gap-3 p-3 transition hover:scale-[1.01]"
        style={{
          borderRadius: theme.radius,
          backgroundColor: theme.cardBackground,
          border: `1px solid ${theme.border}`,
        }}
      >
        <div className="relative h-24 w-24 shrink-0 overflow-hidden" style={{ borderRadius: theme.radius }}>
          <Image src={product.image} alt={product.title} fill className="object-cover" sizes="96px" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div>
            <h3 className="font-semibold leading-snug group-hover:opacity-90">{product.title}</h3>
            <p className="mt-0.5 line-clamp-2 text-xs opacity-70">{product.shortDescription}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold" style={{ color: theme.primaryColor }}>
              {formatPrice(product.price)}
            </span>
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 shrink-0"
              style={{ borderRadius: theme.radius }}
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
