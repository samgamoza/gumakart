"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import {
  hasGrowthFeatures,
  upgradeUrl,
} from "@/lib/storefront-plans";
import { STOREFRONT_REVIEW_SEEDS } from "@/lib/storefront-review-seeds";
import { useCart } from "@/lib/cart";
import { FeatureGate } from "./feature-gate";
import { PremiumSectionHead } from "./section-head";
import { StoreSearchBar } from "./store-search-bar";
import { UpgradeHintBanner } from "./upgrade-hint-banner";
import { useDealCountdown } from "./use-deal-countdown";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

function discountPercent(product: DemoProduct): number | null {
  if (!product.compareAtPrice || product.compareAtPrice <= product.price) return null;
  return Math.round(
    ((product.compareAtPrice - product.price) / product.compareAtPrice) * 100
  );
}

function pseudoStock(productId: string): { left: number; total: number } {
  let hash = 0;
  for (let i = 0; i < productId.length; i++) hash = (hash + productId.charCodeAt(i) * (i + 1)) % 97;
  const total = 20 + (hash % 30);
  const left = 3 + (hash % 12);
  return { left, total };
}

function matchesQuery(product: DemoProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    product.title.toLowerCase().includes(q) ||
    product.category.toLowerCase().includes(q) ||
    product.shortDescription.toLowerCase().includes(q)
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

function ProductMiniCard({
  tenant,
  product,
  badge,
}: {
  tenant: DemoTenant;
  product: DemoProduct;
  badge?: string;
}) {
  const theme = tenant.shopTheme;
  return (
    <Link
      href={`/${tenant.slug}/products/${product.slug}`}
      className="block w-[148px] shrink-0 snap-start"
    >
      <article
        className="overflow-hidden transition hover:scale-[1.02]"
        style={{
          borderRadius: theme.radius,
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.cardBackground,
        }}
      >
        <div className="relative aspect-square w-full overflow-hidden">
          <Image src={product.image} alt={product.title} fill className="object-cover" sizes="148px" />
          {badge && (
            <span
              className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: theme.accentColor, color: theme.mode === "dark" ? theme.foreground : "#fff" }}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="p-2.5">
          <h3 className="line-clamp-2 text-xs font-semibold leading-snug">{product.title}</h3>
          <p className="mt-1 text-sm font-bold" style={{ color: theme.primaryColor }}>
            {formatPrice(product.price)}
          </p>
        </div>
      </article>
    </Link>
  );
}

export function PremiumStorefrontSections({
  tenant,
  wideLayout = false,
  hideSearch = false,
  externalSearch,
}: {
  tenant: DemoTenant;
  wideLayout?: boolean;
  hideSearch?: boolean;
  externalSearch?: string;
}) {
  const theme = tenant.shopTheme;
  const plan = tenant.subscriptionPlan;
  const [internalSearch, setInternalSearch] = useState("");
  const search = externalSearch ?? internalSearch;
  const countdown = useDealCountdown();
  const { addItem } = useCart(tenant.slug);

  const growthUrl = upgradeUrl("growth");

  const filtered = useMemo(() => {
    let list = tenant.products.filter((p) => matchesQuery(p, search));
    return list;
  }, [tenant.products, search]);

  const featured = filtered.slice(0, 6);
  const deals = filtered.filter((p) => p.compareAtPrice && p.compareAtPrice > p.price).slice(0, 4);
  const dealFallback = deals.length > 0 ? deals : filtered.slice(0, 2);
  const newArrivals = [...filtered].reverse().slice(0, 6);
  const popular = filtered.slice(0, 5);
  const liveProducts = filtered.slice(0, 3);

  const maxWidth = wideLayout || theme.layout === "classic" ? "max-w-6xl" : "max-w-lg";
  const sectionPad = wideLayout || theme.layout === "classic" ? "px-4 md:px-8" : "px-4";

  if (tenant.products.length === 0) return null;

  return (
    <>
      <UpgradeHintBanner plan={plan} theme={theme} />

      {!hideSearch && (
        <div className={`mx-auto ${maxWidth} ${sectionPad} pb-2`}>
          <StoreSearchBar theme={theme} value={search} onChange={setInternalSearch} />
        </div>
      )}

      {featured.length > 0 && (
        <section id="featured" className={`mx-auto ${maxWidth} ${sectionPad} py-3`}>
          <PremiumSectionHead title="Featured Products" theme={theme} />
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 snap-x snap-mandatory">
            {featured.map((product) => (
              <ProductMiniCard key={product.id} tenant={tenant} product={product} />
            ))}
          </div>
        </section>
      )}

      <section className={`mx-auto ${maxWidth} ${sectionPad} py-3`}>
        <PremiumSectionHead
          title="Today's Deals"
          theme={theme}
          tier="growth"
          subtitle={
            hasGrowthFeatures(plan)
              ? "Flash deals end at midnight"
              : "Flash deals + countdown timers —"
          }
          upgradeHref={hasGrowthFeatures(plan) ? undefined : growthUrl}
        />
        <FeatureGate
          required="growth"
          plan={plan}
          theme={theme}
          upgradeHref={growthUrl}
          teaser={
            <DealsContent
              tenant={tenant}
              products={dealFallback}
              countdown={countdown}
              onAdd={addItem}
              locked
            />
          }
        >
          <DealsContent
            tenant={tenant}
            products={dealFallback}
            countdown={countdown}
            onAdd={addItem}
          />
        </FeatureGate>
      </section>

      {newArrivals.length > 0 && (
        <section className={`mx-auto ${maxWidth} ${sectionPad} py-3`}>
          <PremiumSectionHead
            title="New Arrivals"
            theme={theme}
            extra={
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{ backgroundColor: theme.accentColor, color: theme.mode === "dark" ? theme.foreground : "#fff" }}
              >
                New
              </span>
            }
          />
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 snap-x snap-mandatory">
            {newArrivals.map((product) => (
              <ProductMiniCard key={product.id} tenant={tenant} product={product} badge="Just in" />
            ))}
          </div>
        </section>
      )}

      <section id="live" className={`mx-auto ${maxWidth} ${sectionPad} py-3`}>
        <PremiumSectionHead
          title="Live Selling"
          theme={theme}
          tier="growth"
          subtitle={
            hasGrowthFeatures(plan)
              ? "Join the live stream and shop in real time"
              : "TikTok-style live selling on your storefront —"
          }
          upgradeHref={hasGrowthFeatures(plan) ? undefined : growthUrl}
        />
        <FeatureGate
          required="growth"
          plan={plan}
          theme={theme}
          upgradeHref={growthUrl}
          teaser={
            <LiveSellingContent tenant={tenant} products={liveProducts} onAdd={addItem} />
          }
        >
          <LiveSellingContent tenant={tenant} products={liveProducts} onAdd={addItem} />
        </FeatureGate>
      </section>

      {popular.length > 0 && (
        <section className={`mx-auto ${maxWidth} ${sectionPad} py-3`} id="popular">
          <PremiumSectionHead title="Popular Products" theme={theme} />
          <div className="mb-3 flex flex-wrap gap-2">
            {["Trending", "Best Seller", "Top Rated"].map((label, i) => (
              <span
                key={label}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  borderRadius: theme.radius,
                  backgroundColor: i === 0 ? theme.primaryColor : "transparent",
                  color: i === 0 ? (theme.mode === "dark" ? theme.foreground : "#fff") : theme.muted,
                  border: i === 0 ? "none" : `1px solid ${theme.border}`,
                }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {popular.map((product, index) => (
              <Link
                key={product.id}
                href={`/${tenant.slug}/products/${product.slug}`}
                className="flex items-center gap-3 p-2.5 transition hover:opacity-90"
                style={{
                  borderRadius: theme.radius,
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.cardBackground,
                }}
              >
                {index < 3 && (
                  <span className="shrink-0 text-[10px] font-bold" style={{ color: theme.accentColor }}>
                    🔥 Hot
                  </span>
                )}
                <div className="relative h-12 w-12 shrink-0 overflow-hidden" style={{ borderRadius: theme.radius }}>
                  <Image src={product.image} alt="" fill className="object-cover" sizes="48px" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{product.title}</p>
                  <p className="text-xs" style={{ color: theme.muted }}>
                    {product.category}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold" style={{ color: theme.primaryColor }}>
                  {formatPrice(product.price)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={`mx-auto ${maxWidth} ${sectionPad} py-3`}>
        <PremiumSectionHead
          title="Customer Reviews"
          theme={theme}
          tier="growth"
          subtitle={
            hasGrowthFeatures(plan)
              ? "What shoppers are saying"
              : "Build trust with verified reviews —"
          }
          upgradeHref={hasGrowthFeatures(plan) ? undefined : growthUrl}
        />
        <FeatureGate
          required="growth"
          plan={plan}
          theme={theme}
          upgradeHref={growthUrl}
          teaser={<ReviewsContent theme={theme} shopName={tenant.name} />}
        >
          <ReviewsContent theme={theme} shopName={tenant.name} />
        </FeatureGate>
      </section>
    </>
  );
}

function DealsContent({
  tenant,
  products,
  countdown,
  onAdd,
  locked = false,
}: {
  tenant: DemoTenant;
  products: DemoProduct[];
  countdown: string;
  onAdd: ReturnType<typeof useCart>["addItem"];
  locked?: boolean;
}) {
  const theme = tenant.shopTheme;

  return (
    <>
      <div
        className="mb-3 flex items-center justify-between gap-3 px-4 py-3 text-white"
        style={{
          borderRadius: theme.radius,
          background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
        }}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-90">⚡ Today&apos;s Deals</p>
          <p className="text-xs opacity-80">Deal ends in</p>
        </div>
        <div className="font-mono text-lg font-bold tracking-wider" aria-live="polite">
          {countdown}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {products.map((product) => {
          const discount = discountPercent(product);
          const stock = pseudoStock(product.id);
          const pct = Math.round((stock.left / stock.total) * 100);
          return (
            <article
              key={product.id}
              style={{
                borderRadius: theme.radius,
                border: `1px solid ${theme.border}`,
                backgroundColor: theme.cardBackground,
              }}
            >
              <div className="relative aspect-[4/3] overflow-hidden" style={{ borderRadius: `${theme.radius} ${theme.radius} 0 0` }}>
                <Image src={product.image} alt={product.title} fill className="object-cover" sizes="200px" />
                {discount !== null && (
                  <span
                    className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: theme.accentColor }}
                  >
                    -{discount}%
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <h3 className="line-clamp-2 text-xs font-semibold">⚡ {product.title}</h3>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-sm font-bold" style={{ color: theme.primaryColor }}>
                    {formatPrice(product.price)}
                  </span>
                  {product.compareAtPrice && (
                    <span className="text-[10px] line-through" style={{ color: theme.muted }}>
                      {formatPrice(product.compareAtPrice)}
                    </span>
                  )}
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden"
                  style={{ borderRadius: theme.radius, backgroundColor: `${theme.border}` }}
                >
                  <div
                    className="h-full transition-all"
                    style={{ width: `${100 - pct}%`, backgroundColor: theme.primaryColor }}
                  />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: theme.muted }}>
                  Only {stock.left} left!
                </p>
                <button
                  type="button"
                  disabled={locked}
                  className="mt-2 w-full rounded-full py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: theme.primaryColor }}
                  onClick={() =>
                    onAdd({
                      productId: product.id,
                      slug: product.slug,
                      title: product.title,
                      price: product.price,
                      image: product.image,
                    })
                  }
                >
                  Grab Deal
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function LiveSellingContent({
  tenant,
  products,
  onAdd,
}: {
  tenant: DemoTenant;
  products: DemoProduct[];
  onAdd: ReturnType<typeof useCart>["addItem"];
}) {
  const theme = tenant.shopTheme;

  return (
    <div
      style={{
        borderRadius: theme.radius,
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.cardBackground,
        overflow: "hidden",
      }}
    >
      <div
        className="relative flex h-28 items-end p-4"
        style={{
          background: `linear-gradient(135deg, ${theme.primaryColor}88, ${theme.accentColor}66)`,
        }}
      >
        <span
          className="absolute left-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: "#ef4444" }}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          LIVE
        </span>
        {/* Phase 20: removed a random "N watching" count — buyers shouldn't see invented numbers. */}
        <p className="text-sm font-semibold text-white">{tenant.name} Live</p>
      </div>
      <div className="divide-y" style={{ borderColor: theme.border }}>
        {products.map((product) => (
          <div key={product.id} className="flex items-center gap-3 p-3">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden" style={{ borderRadius: theme.radius }}>
              <Image src={product.image} alt="" fill className="object-cover" sizes="44px" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{product.title}</p>
              <p className="text-sm font-bold" style={{ color: theme.primaryColor }}>
                {formatPrice(product.price)}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: theme.primaryColor }}
              onClick={() =>
                onAdd({
                  productId: product.id,
                  slug: product.slug,
                  title: product.title,
                  price: product.price,
                  image: product.image,
                })
              }
            >
              Buy Now
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 p-3" style={{ backgroundColor: `${theme.background}88` }}>
        {[
          { name: "Kaye", text: "Available pa po yung bundle?" },
          { name: "Migs", text: "Ordered! Excited na 😍" },
        ].map((chat) => (
          <p key={chat.name} className="text-xs" style={{ color: theme.muted }}>
            <b style={{ color: theme.foreground }}>{chat.name}</b> {chat.text}
          </p>
        ))}
      </div>
    </div>
  );
}

function ReviewsContent({
  theme,
  shopName,
}: {
  theme: DemoTenant["shopTheme"];
  shopName: string;
}) {
  const reviews = STOREFRONT_REVIEW_SEEDS;
  const avg =
    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  return (
    <div
      className="p-4"
      style={{
        borderRadius: theme.radius,
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.cardBackground,
      }}
    >
      <div className="mb-4 flex items-center gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold" style={{ color: theme.primaryColor }}>
            {avg.toFixed(1)}
          </p>
          <Stars rating={Math.round(avg)} />
          <p className="mt-1 text-[10px]" style={{ color: theme.muted }}>
            {reviews.length} reviews
          </p>
        </div>
        <div className="flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = reviews.filter((r) => r.rating === star).length;
            const pct = (count / reviews.length) * 100;
            return (
              <div key={star} className="flex items-center gap-2 text-[10px]">
                <span style={{ color: theme.muted }}>{star}★</span>
                <div
                  className="h-1.5 flex-1 overflow-hidden"
                  style={{ borderRadius: theme.radius, backgroundColor: theme.border }}
                >
                  <div
                    className="h-full"
                    style={{ width: `${pct}%`, backgroundColor: theme.primaryColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 snap-x">
        {reviews.map((review) => (
          <article
            key={review.id}
            className="w-[220px] shrink-0 snap-start p-3"
            style={{
              borderRadius: theme.radius,
              border: `1px solid ${theme.border}`,
              backgroundColor: theme.background,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{review.name}</p>
              <Stars rating={review.rating} />
            </div>
            <p className="mt-0.5 text-[10px]" style={{ color: theme.muted }}>
              {review.location} · {shopName}
            </p>
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed">{review.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
