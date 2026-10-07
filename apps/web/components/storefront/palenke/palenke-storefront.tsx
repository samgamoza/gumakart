"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Gift, MapPin, ShoppingBasket, ShoppingCart } from "lucide-react";
import type { DemoProduct, DemoTenant } from "@/lib/demo-data";
import { useCart } from "@/lib/cart";
import { ctaTextColor, solidCtaColor } from "@/lib/color-contrast";
import { RatingStars } from "@/components/rating-stars";
import { WishlistButton } from "@/components/wishlist-button";
import { ShopAssistant } from "@/components/storefront/shop-assistant";

/**
 * Phase 34: "Palenke" — a clean, bright storefront modelled on the palenkeAi mood board:
 * a gradient banner in the shop's colour, pill category chips, and rounded product cards with a
 * category chip, bold uppercase titles, "Details" and a solid "Add to basket" button.
 * Copy is honest: no invented stock counts, delivery times or ratings — only what the shop has set.
 */

const DEFAULT_PROMO_TITLE = "Free delivery on orders ₱500+";
const DEFAULT_PROMO_SUBTITLE = "Metro Manila · Until 9 PM";

function peso(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function categoryKey(p: DemoProduct): string {
  return p.categorySlug || (p.category ? slugify(p.category) : "");
}

function paymentLabels(tenant: DemoTenant): string[] {
  const s = tenant.storeSettings;
  const r = s.payments?.receiving;
  const online = s.payments?.mode === "paymongo" || s.payments?.mode === "both";
  const out: string[] = [];
  if (online || r?.gcashNumber) out.push("GCash");
  if (online || r?.mayaNumber) out.push("Maya");
  if (online) out.push("Card");
  if (r?.bankAccountNumber) out.push(r.bankName || "Bank transfer");
  if (tenant.codEnabled) out.push("Cash on delivery");
  return out;
}

function shortShipDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function PalenkeStorefront({ tenant }: { tenant: DemoTenant }) {
  const primary = solidCtaColor(tenant.shopTheme.primaryColor, "#4f46e5");
  const accent = tenant.shopTheme.accentColor || "#7c3aed";
  const { items, ready } = useCart(tenant.slug);
  const cartCount = ready ? items.reduce((n, i) => n + i.qty, 0) : 0;
  const [active, setActive] = useState("all");

  const categories = useMemo(() => {
    const used = new Set(tenant.products.map(categoryKey).filter(Boolean));
    const fromShop = tenant.shopCategories.filter((c) => used.has(c.slug)).map((c) => ({ slug: c.slug, name: c.name }));
    const known = new Set(fromShop.map((c) => c.slug));
    for (const p of tenant.products) {
      const key = categoryKey(p);
      if (key && !known.has(key) && p.category) {
        known.add(key);
        fromShop.push({ slug: key, name: p.category });
      }
    }
    return fromShop;
  }, [tenant.products, tenant.shopCategories]);

  const shown = active === "all" ? tenant.products : tenant.products.filter((p) => categoryKey(p) === active);

  const promoTitle =
    tenant.shopTheme.promoTitle && tenant.shopTheme.promoTitle !== DEFAULT_PROMO_TITLE ? tenant.shopTheme.promoTitle : tenant.name;
  const promoSubtitle =
    tenant.shopTheme.promoSubtitle && tenant.shopTheme.promoSubtitle !== DEFAULT_PROMO_SUBTITLE
      ? tenant.shopTheme.promoSubtitle
      : tenant.tagline;
  const pays = paymentLabels(tenant);

  return (
    <div
      className="min-h-screen bg-slate-50 font-sans text-slate-900"
      style={{
        ["--pk-primary" as string]: primary,
        ["--pk-primary-ink" as string]: ctaTextColor(primary),
        ["--pk-accent" as string]: accent,
      }}
      data-testid="palenke-storefront"
    >
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href={`/${tenant.slug}`} className="flex min-w-0 items-center gap-3">
            {tenant.logoUrl ? (
              <Image src={tenant.logoUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl">{tenant.logoEmoji}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-base font-extrabold uppercase tracking-tight sm:text-lg">{tenant.name}</span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ordering online
              </span>
            </span>
          </Link>
          <Link
            href={`/${tenant.slug}/checkout`}
            className="relative ml-auto flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
            aria-label={`Basket, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
            data-testid="palenke-cart"
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pk-primary)] px-1 text-[11px] font-bold text-[var(--pk-primary-ink)]">
                {cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 pb-16 pt-6 sm:px-6">
        <section
          className="relative overflow-hidden rounded-[1.75rem] p-6 text-white shadow-[0_20px_50px_-24px_rgba(49,46,129,.55)] sm:p-8"
          style={{
            backgroundImage: `linear-gradient(120deg, color-mix(in srgb, ${primary} 92%, #4f46e5) 0%, color-mix(in srgb, ${primary} 55%, #312e81) 100%)`,
          }}
          data-testid="palenke-banner"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <span className="inline-block rounded-md bg-white/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                {tenant.category || "Shop"}
              </span>
              <h1 className="mt-3 text-3xl font-black uppercase leading-[1.05] tracking-tight sm:text-4xl">{promoTitle}</h1>
              {promoSubtitle ? <p className="mt-3 text-sm leading-relaxed text-white/85 sm:text-base">{promoSubtitle}</p> : null}
              <RatingStars rating={tenant.rating} className="mt-3 text-white [&_svg.text-slate-300]:text-white/40" />
            </div>
            {pays.length > 0 || tenant.location ? (
              <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur-sm">
                {pays.length > 0 ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Pay with</p>
                    <p className="mt-1 max-w-[16rem] text-base font-extrabold text-amber-300">{pays.join(" · ")}</p>
                  </>
                ) : null}
                {tenant.location ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-white/80">
                    <MapPin className="h-3.5 w-3.5" /> {tenant.location}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {tenant.referral ? <ReferralStrip shopName={tenant.name} referral={tenant.referral} /> : null}

        {categories.length > 1 ? (
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Categories">
            {[{ slug: "all", name: "All" }, ...categories].map((c) => {
              const on = active === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setActive(c.slug)}
                  aria-pressed={on}
                  className={`shrink-0 rounded-xl border px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider transition ${
                    on
                      ? "border-transparent bg-[var(--pk-primary)] text-[var(--pk-primary-ink)] shadow-md"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                  data-testid="palenke-chip"
                >
                  {c.name}
                </button>
              );
            })}
          </nav>
        ) : null}

        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No items here yet. Check back soon.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <PalenkeCard key={p.id} tenantSlug={tenant.slug} product={p} />
            ))}
          </div>
        )}
      </main>

      <footer className="bg-slate-950 px-6 py-10 text-center text-sm text-slate-400">
        <p className="font-extrabold uppercase tracking-wide text-white">{tenant.name}</p>
        {tenant.tagline ? <p className="mx-auto mt-2 max-w-md">{tenant.tagline}</p> : null}
        {tenant.location ? <p className="mt-2">{tenant.location}</p> : null}
        <p className="mt-6 text-xs text-slate-500">
          © {new Date().getFullYear()} {tenant.name} · Powered by Guma Kart
        </p>
      </footer>

      {(tenant.storeSettings.shopAssistant.enabled || tenant.storeSettings.shopAssistant.humanInbox !== false) && (
        <ShopAssistant tenantSlug={tenant.slug} shopName={tenant.name} assistant={tenant.storeSettings.shopAssistant} />
      )}
    </div>
  );
}

function PalenkeCard({ tenantSlug, product }: { tenantSlug: string; product: DemoProduct }) {
  const { addItem, ready } = useCart(tenantSlug);
  const [added, setAdded] = useState(false);
  const href = `/${tenantSlug}/products/${product.slug}`;
  const soldOut = product.available === false && !product.preorderShipDate;
  const preorder = Boolean(product.preorderShipDate);
  const onSale = product.compareAtPrice != null && product.compareAtPrice > product.price;

  function add() {
    addItem({ productId: product.id, slug: product.slug, title: product.title, price: product.price, image: product.image });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1400);
  }

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_14px_34px_-20px_rgba(15,23,42,.25)]"
      data-testid="palenke-card"
    >
      <Link href={href} className="relative block aspect-[4/3] overflow-hidden bg-slate-100">
        {product.image ? (
          <Image
            src={product.image}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 330px"
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute right-3 top-3 rounded-lg bg-white px-2.5 py-1 text-sm font-extrabold text-slate-900 shadow">
          {peso(product.price)}
          {onSale ? <span className="ml-1.5 text-xs font-semibold text-slate-400 line-through">{peso(product.compareAtPrice!)}</span> : null}
        </span>
        <span className="absolute left-3 top-3">
          <WishlistButton tenantSlug={tenantSlug} productId={product.id} />
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          {product.category ? (
            <span className="truncate rounded-md bg-[color-mix(in_srgb,var(--pk-primary)_10%,white)] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[color-mix(in_srgb,var(--pk-primary)_80%,#0f172a)]">
              {product.category}
            </span>
          ) : (
            <span />
          )}
          {soldOut ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Sold out</span>
          ) : preorder ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
              Pre-order · ships ~{shortShipDate(product.preorderShipDate!)}
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 text-lg font-black uppercase leading-snug tracking-tight">
          <Link href={href} className="hover:underline">
            {product.title}
          </Link>
        </h3>
        <RatingStars rating={product.rating} className="mt-1 text-slate-600" />
        {product.shortDescription && product.shortDescription.trim() !== product.title.trim() ? <p className="mt-2 line-clamp-2 text-sm text-slate-500">{product.shortDescription}</p> : null}
        <div className="mt-auto flex gap-3 border-t border-slate-100 pt-4">
          <Link
            href={href}
            className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 px-5 text-xs font-extrabold uppercase tracking-wider text-slate-700 hover:bg-slate-200"
          >
            Details
          </Link>
          {soldOut ? (
            <Link
              href={href}
              className="flex h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 text-xs font-extrabold uppercase tracking-wider text-slate-600"
            >
              Notify me
            </Link>
          ) : (
            <button
              type="button"
              disabled={!ready}
              onClick={add}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--pk-primary)] text-xs font-extrabold uppercase tracking-wider text-[var(--pk-primary-ink)] shadow-md transition hover:brightness-110 disabled:opacity-60"
              data-testid="palenke-add"
            >
              <ShoppingBasket className="h-4 w-4" />
              {added ? "Added" : preorder ? "Pre-order" : "Add to basket"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Shown only when the shop has buyer referrals on. Amounts come from the shop's Suki settings.
 * Buyers get their own link on their order page after ordering, so there's no sign-up button here.
 */
function ReferralStrip({ shopName, referral }: { shopName: string; referral: NonNullable<DemoTenant["referral"]> }) {
  const both = referral.friendReward > 0 && referral.referrerReward > 0;
  const headline = both
    ? `Invite a friend: ${peso(referral.friendReward)} for them, ${peso(referral.referrerReward)} for you`
    : referral.friendReward > 0
      ? `Invite a friend: they get ${peso(referral.friendReward)} store credit`
      : `Invite a friend: you get ${peso(referral.referrerReward)} store credit`;
  return (
    <section
      className="flex items-start gap-4 rounded-[1.5rem] bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-5 text-white shadow-[0_16px_40px_-24px_rgba(234,88,12,.7)] sm:items-center sm:p-6"
      data-testid="palenke-referral"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
        <Gift className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <span className="inline-block rounded-md bg-black/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Suki referral</span>
        <p className="mt-1.5 text-base font-extrabold leading-snug sm:text-lg">{headline}</p>
        <p className="mt-1 text-sm text-white/90">
          Order from {shopName} and get your own share link on your order page. Credit is added after your friend&apos;s first paid
          order of {peso(referral.minOrder)} or more.
        </p>
      </div>
    </section>
  );
}
