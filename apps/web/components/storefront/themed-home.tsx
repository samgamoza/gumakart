import Link from "next/link";
import { sizedImageUrl } from "@/lib/image-sizes";
import { ShoppingBag, Sparkles } from "lucide-react";
import { PremiumStorefrontSections } from "@/components/storefront/premium/premium-storefront-sections";
import { ShopAssistant } from "@/components/storefront/shop-assistant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoTenant } from "@/lib/demo-data";
import { heroBackground, StorefrontThemeShell } from "./theme-shell";
import { ThemedProductCard } from "./themed-product-card";

function PromoBanner({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;

  if (theme.layout === "immersive") {
    return (
      <section className="mx-auto max-w-lg px-4 py-4">
        <div
          className="relative overflow-hidden p-5 shadow-lg"
          style={{
            borderRadius: theme.radius,
            background: `linear-gradient(135deg, ${theme.primaryColor}33, ${theme.accentColor}44)`,
            border: `1px solid ${theme.border}`,
          }}
        >
          <Sparkles className="absolute right-4 top-4 h-5 w-5 opacity-60" style={{ color: theme.accentColor }} />
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Featured drop</p>
          <h2 className="mt-1 text-xl font-bold">{theme.promoTitle}</h2>
          <p className="mt-1 text-sm opacity-80">{theme.promoSubtitle}</p>
        </div>
      </section>
    );
  }

  if (theme.card === "brutal") {
    return (
      <section className="mx-auto max-w-lg px-4 py-4">
        <div
          className="border-4 p-4 shadow-[6px_6px_0_0_currentColor]"
          style={{
            borderColor: theme.foreground,
            backgroundColor: theme.accentColor,
            color: theme.foreground,
            borderRadius: theme.radius,
          }}
        >
          <p className="text-xs font-black uppercase">Hot today</p>
          <h2 className="mt-1 text-lg font-black">{theme.promoTitle}</h2>
          <p className="text-sm font-medium">{theme.promoSubtitle}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-lg px-4 py-4">
      <div
        className="relative overflow-hidden p-5 text-white shadow-lg"
        style={{
          borderRadius: theme.radius,
          background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
        }}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
        <p className="relative text-xs font-semibold uppercase tracking-wider opacity-90">
          Promo
        </p>
        <h2 className="relative mt-1 text-xl font-bold">{theme.promoTitle}</h2>
        <p className="relative mt-1 text-sm opacity-90">{theme.promoSubtitle}</p>
      </div>
    </section>
  );
}

function StoreHeaderThemed({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;
  const heroStyle = heroBackground(theme, tenant.coverUrl);

  if (theme.header === "floating-glass") {
    return (
      <>
        <div className="relative h-36" style={heroStyle} />
        <header className="sticky top-0 z-40 px-4 pb-3 pt-2">
          <div
            className="mx-auto max-w-lg border px-4 py-3 backdrop-blur-xl"
            style={{
              borderRadius: theme.radius,
              borderColor: theme.border,
              backgroundColor: theme.cardBackground,
            }}
          >
            <div className="flex items-center gap-3">
              <LogoMark tenant={tenant} />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold">{tenant.name}</h1>
                <p className="truncate text-xs opacity-70">{tenant.tagline}</p>
              </div>
              <OrderButton tenant={tenant} />
            </div>
          </div>
        </header>
      </>
    );
  }

  if (theme.header === "minimal") {
    return (
      <header
        className="sticky top-0 z-40 border-b px-4 py-4"
        style={{ borderColor: theme.border, backgroundColor: theme.cardBackground }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-50">
              {tenant.category}
            </p>
            <h1 className="text-xl font-bold tracking-tight">{tenant.name}</h1>
          </div>
          <OrderButton tenant={tenant} variant="outline" />
        </div>
      </header>
    );
  }

  if (theme.header === "sticker") {
    return (
      <>
        <div className="relative h-32 overflow-hidden" style={heroStyle}>
          <div
            className="absolute left-4 top-4 rotate-[-4deg] px-3 py-1 text-xs font-black uppercase"
            style={{ backgroundColor: theme.accentColor, color: theme.foreground, borderRadius: theme.radius }}
          >
            Open now
          </div>
        </div>
        <header className="mx-auto max-w-lg px-4 pb-3">
          <div className="-mt-8 flex items-end gap-3">
            <LogoMark tenant={tenant} large />
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-lg font-black">{tenant.name}</h1>
              <p className="truncate text-xs opacity-70">{tenant.tagline}</p>
            </div>
            <OrderButton tenant={tenant} />
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <div className="h-28" style={heroStyle} />
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-xl"
        style={{ borderColor: theme.border, backgroundColor: `${theme.cardBackground}ee` }}
      >
        <div className="mx-auto max-w-lg px-4">
          <div className="-mt-10 flex items-end gap-3 pb-3">
            <LogoMark tenant={tenant} large />
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-lg font-bold">{tenant.name}</h1>
              <p className="truncate text-xs opacity-70">{tenant.tagline}</p>
            </div>
            <OrderButton tenant={tenant} />
          </div>
        </div>
      </header>
    </>
  );
}

function LogoMark({ tenant, large }: { tenant: DemoTenant; large?: boolean }) {
  const theme = tenant.shopTheme;
  const size = large ? "h-16 w-16 text-3xl" : "h-12 w-12 text-2xl";

  if (tenant.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sizedImageUrl(tenant.logoUrl, 64)}
        alt=""
        decoding="async"
        className={`${size} shrink-0 border-4 border-white object-cover shadow-lg`}
        style={{ borderRadius: theme.radius, borderColor: theme.mode === "dark" ? theme.foreground : "#fff" }}
      />
    );
  }

  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center border-4 shadow-lg`}
      style={{
        borderRadius: theme.radius,
        borderColor: theme.mode === "dark" ? theme.foreground : "#fff",
        backgroundColor: `${theme.primaryColor}22`,
      }}
    >
      {tenant.logoEmoji}
    </div>
  );
}

function OrderButton({
  tenant,
  variant = "default",
}: {
  tenant: DemoTenant;
  variant?: "default" | "outline";
}) {
  const theme = tenant.shopTheme;
  return (
    <Link href={`/${tenant.slug}/checkout`}>
      <Button
        size="sm"
        variant={variant === "outline" ? "outline" : "default"}
        className="shrink-0 gap-1.5 shadow-md"
        style={
          variant === "default"
            ? { backgroundColor: theme.primaryColor, color: theme.mode === "dark" ? theme.foreground : "#fff" }
            : { borderColor: theme.border, color: theme.foreground }
        }
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        Order
      </Button>
    </Link>
  );
}

export function ThemedStorefrontHome({
  tenant,
  utmLabel,
}: {
  tenant: DemoTenant;
  utmLabel?: string;
}) {
  const theme = tenant.shopTheme;
  const categories = [...new Set(tenant.products.map((p) => p.category))];
  const gridLayout = theme.card === "grid" || theme.layout === "bento" || theme.card === "magazine";

  return (
    <StorefrontThemeShell theme={theme} className="min-h-screen pb-28">
      <StoreHeaderThemed tenant={tenant} />

      {utmLabel && (
        <div className="mx-auto max-w-lg px-4 pt-3">
          <Badge variant="social" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Welcome from {utmLabel}!
          </Badge>
        </div>
      )}

      <PromoBanner tenant={tenant} />

      <PremiumStorefrontSections tenant={tenant} />

      {categories.length > 0 && (
        <div className="mx-auto max-w-lg overflow-x-auto px-4 pb-2">
          <div className="flex gap-2">
            <button
              className="shrink-0 px-4 py-1.5 text-xs font-semibold text-white"
              style={{ borderRadius: theme.radius, backgroundColor: theme.primaryColor }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className="shrink-0 border px-4 py-1.5 text-xs font-medium"
                style={{ borderRadius: theme.radius, borderColor: theme.border, color: theme.muted }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {categories.length === 0 ? (
        <section className="mx-auto max-w-lg px-4 py-12 text-center">
          <p className="text-lg font-bold">Products coming soon</p>
          <p className="mt-2 text-sm opacity-70">This shop is setting up. Check back shortly.</p>
        </section>
      ) : (
        categories.map((category) => (
          <section key={category} className="mx-auto max-w-lg px-4 py-3">
            <h2 className="mb-3 text-base font-bold">{category}</h2>
            <div className={gridLayout ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
              {tenant.products
                .filter((p) => p.category === category)
                .map((product) => (
                  <ThemedProductCard
                    key={product.id}
                    tenantSlug={tenant.slug}
                    product={product}
                    theme={theme}
                  />
                ))}
            </div>
          </section>
        ))
      )}

      <section className="mx-auto max-w-lg px-4 py-6">
        <div
          className="border border-dashed p-5 text-center"
          style={{
            borderRadius: theme.radius,
            borderColor: `${theme.primaryColor}55`,
            backgroundColor: `${theme.primaryColor}11`,
          }}
        >
          <p className="text-sm font-medium">Share your Order Now link</p>
          <code
            className="mt-2 block truncate px-3 py-2.5 text-xs"
            style={{
              borderRadius: theme.radius,
              backgroundColor: theme.cardBackground,
              color: theme.primaryColor,
            }}
          >
            {process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3000"}/{tenant.slug}
          </code>
        </div>
      </section>

      {(tenant.storeSettings.shopAssistant.enabled || tenant.storeSettings.shopAssistant.humanInbox !== false) && (
        <ShopAssistant
          tenantSlug={tenant.slug}
          shopName={tenant.name}
          assistant={tenant.storeSettings.shopAssistant}
        />
      )}
    </StorefrontThemeShell>
  );
}
