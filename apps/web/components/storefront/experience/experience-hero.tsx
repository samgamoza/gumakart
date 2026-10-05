"use client";

import Image from "next/image";
import Link from "next/link";
import { Play, ShoppingBag, Sparkles } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useStorefrontExperience } from "./storefront-experience-context";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function ExperienceHero() {
  const { tenant } = useStorefrontExperience();
  const { addItem } = useCart(tenant.slug);
  const theme = tenant.shopTheme;
  const spotlight =
    tenant.products.find((p) => p.compareAtPrice && p.compareAtPrice > p.price) ??
    tenant.products[0];

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative overflow-hidden rounded-3xl bg-foreground p-7 text-background sm:p-10">
          <div className="relative z-10 max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              <Sparkles className="size-3.5" /> {tenant.category}
            </span>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-5xl">
              {tenant.tagline}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-background/70 text-pretty sm:text-base">
              {theme.promoTitle}
              {theme.promoSubtitle ? ` · ${theme.promoSubtitle}` : ""}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="#live"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-95"
              >
                <Play className="size-4 fill-current" /> Watch live
              </a>
              <a
                href="#featured"
                className="inline-flex items-center gap-2 rounded-full bg-background/15 px-5 py-2.5 text-sm font-semibold text-background backdrop-blur transition-colors hover:bg-background/25"
              >
                <ShoppingBag className="size-4" /> Shop now
              </a>
            </div>
            <div className="mt-7 flex gap-6 text-sm">
              <div>
                <p className="font-display text-2xl font-bold">{tenant.products.length}+</p>
                <p className="text-background/60">Products</p>
              </div>
              <div>
                <p className="font-display text-2xl font-bold">2 min</p>
                <p className="text-background/60">Avg. checkout</p>
              </div>
              <div>
                <p className="font-display text-2xl font-bold">GCash</p>
                <p className="text-background/60">Pay online</p>
              </div>
            </div>
          </div>
          <Sparkles className="absolute -right-6 -top-6 size-40 text-background/5" />
        </div>

        {spotlight && (
          <div className="relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              🔥 Trending now
            </span>
            <div className="relative my-4 aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
              <Image
                src={spotlight.image}
                alt={spotlight.title}
                fill
                sizes="(max-width: 1024px) 100vw, 33vw"
                className="object-cover"
              />
            </div>
            <h2 className="font-display text-lg font-bold text-card-foreground">{spotlight.title}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-display text-2xl font-bold text-primary">
                {formatPrice(spotlight.price)}
              </span>
              {spotlight.compareAtPrice && (
                <span className="text-sm text-muted-foreground line-through">
                  {formatPrice(spotlight.compareAtPrice)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                addItem({
                  productId: spotlight.id,
                  slug: spotlight.slug,
                  title: spotlight.title,
                  price: spotlight.price,
                  image: spotlight.image,
                })
              }
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-foreground py-3 text-sm font-semibold text-background transition-transform active:scale-95"
            >
              <ShoppingBag className="size-4" /> Add to cart
            </button>
            <Link
              href={`/${tenant.slug}/products/${spotlight.slug}`}
              className="mt-2 text-center text-xs text-muted-foreground underline"
            >
              View details
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
