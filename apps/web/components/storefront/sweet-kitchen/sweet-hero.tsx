"use client";

import { sizedImageUrl, sizedSrcSet } from "@/lib/image-sizes";
import Link from "next/link";
import { Clock, MapPin, Plus, Star } from "lucide-react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";

const DEFAULT_HERO =
  "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=1600&q=80";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace(/\.00$/, "");
}

/** Pick two hero picks: bestsellers first, then anything on sale, then the rest. */
function heroPicks(products: DemoProduct[]): DemoProduct[] {
  const score = (p: DemoProduct) =>
    (p.tags?.includes("bestseller") ? 2 : 0) + (p.compareAtPrice ? 1 : 0);
  return [...products].sort((a, b) => score(b) - score(a)).slice(0, 2);
}

function HeroPick({
  tenantSlug,
  product,
  accent,
  onAdd,
  className,
}: {
  tenantSlug: string;
  product: DemoProduct;
  accent: string;
  onAdd: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex w-[264px] items-center gap-3 rounded-2xl border border-[#2d1b1b]/10 bg-[#fffdf5] p-3 shadow-[0_18px_40px_-20px_rgba(45,27,27,0.45)] ${className ?? ""}`}
    >
      <Link
        href={`/${tenantSlug}/products/${product.slug}`}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#ffd1dc]/50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sizedImageUrl(product.image, 160)}
          srcSet={sizedSrcSet(product.image, 160)}
          sizes="64px"
          alt={product.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/${tenantSlug}/products/${product.slug}`}
          className="line-clamp-2 block font-heading text-[15px] font-semibold leading-tight text-[#2d1b1b]"
        >
          {product.title}
        </Link>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-sm font-semibold" style={{ color: accent }}>
            {formatPrice(product.price)}
          </span>
          {product.compareAtPrice && (
            <span className="text-xs text-[#2d1b1b]/40 line-through">
              {formatPrice(product.compareAtPrice)}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ backgroundColor: accent, outlineColor: accent }}
        aria-label={`Add ${product.title} to cart`}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function SweetHero({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;
  const accent = theme.primaryColor;
  const heroImage = tenant.coverUrl ?? DEFAULT_HERO;
  const { addItem } = useCart(tenant.slug);
  const picks = heroPicks(tenant.products);

  const words = tenant.name.trim().split(/\s+/);
  const scriptName = words.length > 1 ? words.slice(0, -1).join(" ") : tenant.name;
  const lastWord = words.length > 1 ? words[words.length - 1] : null;

  const add = (product: DemoProduct) =>
    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      image: product.image,
    });

  return (
    <section className="relative overflow-hidden pt-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-12 pt-4 md:pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        {/* Copy */}
        <div className="max-w-xl">
          {tenant.rating && (
            <p className="mb-5 inline-flex items-center gap-1.5 text-sm text-[#2d1b1b]/70">
              <Star className="h-4 w-4 fill-current" style={{ color: theme.accentColor }} />
              {tenant.rating.average.toFixed(1)} from {tenant.rating.count} verified orders
            </p>
          )}
          <h1 className="font-display text-[3.75rem] leading-[0.9] text-[#2d1b1b] sm:text-[5rem] md:text-[6rem]">
            {scriptName}
            {lastWord && (
              <span className="font-heading mt-2 block text-3xl font-semibold leading-none tracking-tight md:text-4xl">
                {lastWord}
              </span>
            )}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-[#2d1b1b]/70 md:text-xl">
            {tenant.tagline}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={`/${tenant.slug}#shop`}
              className="neon-btn inline-flex items-center rounded-full px-7 py-3.5 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ backgroundColor: accent, outlineColor: accent }}
            >
              See the menu
            </Link>
            <Link
              href={`/${tenant.slug}/checkout`}
              className="inline-flex items-center rounded-full border border-[#2d1b1b]/20 px-7 py-3.5 text-[15px] font-semibold text-[#2d1b1b] transition hover:border-[#2d1b1b]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Go to cart
            </Link>
          </div>

          <dl className="mt-10 grid max-w-md gap-4 border-t border-[#2d1b1b]/10 pt-6 text-sm sm:grid-cols-2">
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
              <div>
                <dt className="font-semibold text-[#2d1b1b]">{theme.promoTitle}</dt>
                <dd className="text-[#2d1b1b]/60">{tenant.location}</dd>
              </div>
            </div>
            {theme.promoSubtitle && (
              <div className="flex gap-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
                <div>
                  <dt className="font-semibold text-[#2d1b1b]">Same-day delivery</dt>
                  <dd className="text-[#2d1b1b]/60">{theme.promoSubtitle}</dd>
                </div>
              </div>
            )}
          </dl>
        </div>

        {/* Tray: photo + two live picks layered over it */}
        <div className="relative order-first mx-auto w-full max-w-[440px] lg:order-none lg:mx-0 lg:justify-self-end">
          <div
            aria-hidden
            className="absolute -right-3 -top-3 h-full w-full rounded-[2rem] bg-[#ffd1dc]/70 lg:-right-5 lg:-top-5"
          />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-[#ffd1dc]/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sizedImageUrl(heroImage, 800)}
              srcSet={sizedSrcSet(heroImage, 800)}
              sizes="(max-width: 1024px) 100vw, 440px"
              alt={`${tenant.name} signature dessert`}
              fetchPriority="high"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>

          {picks[0] && (
            <HeroPick
              tenantSlug={tenant.slug}
              product={picks[0]}
              accent={accent}
              onAdd={() => add(picks[0])}
              className="absolute -left-3 top-10 -rotate-2 sm:-left-10"
            />
          )}
          {picks[1] && (
            <HeroPick
              tenantSlug={tenant.slug}
              product={picks[1]}
              accent={accent}
              onAdd={() => add(picks[1])}
              className="absolute -bottom-6 right-3 rotate-2 sm:-right-6"
            />
          )}
        </div>
      </div>
    </section>
  );
}
