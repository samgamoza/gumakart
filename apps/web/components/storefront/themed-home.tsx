import Link from "next/link";
import { sizedImageUrl } from "@/lib/image-sizes";
import { CreditCard, MousePointerClick, PackageCheck, PackagePlus, ShoppingBag, Sparkles } from "lucide-react";
import { PremiumStorefrontSections } from "@/components/storefront/premium/premium-storefront-sections";
import { ShopAssistant } from "@/components/storefront/shop-assistant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoTenant } from "@/lib/demo-data";
import { adminUrl, shopPublicUrl } from "@/lib/utils";
import { heroBackground, StorefrontThemeShell } from "./theme-shell";
import { ThemedProductCard } from "./themed-product-card";

/** Phone column by default; widens on tablet and desktop so the shop doesn't float in a 512px strip. */
const WRAP = "mx-auto w-full max-w-lg px-4 md:max-w-3xl md:px-6 lg:max-w-5xl";
const HEAD_WRAP = "mx-auto w-full max-w-lg md:max-w-3xl lg:max-w-5xl";

function PromoBanner({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;

  if (theme.layout === "immersive") {
    return (
      <section className={`${WRAP} py-4`}>
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
          <h2 className="mt-1 text-xl font-bold md:text-3xl">{theme.promoTitle}</h2>
          <p className="mt-1 text-sm opacity-80 md:text-base">{theme.promoSubtitle}</p>
        </div>
      </section>
    );
  }

  if (theme.card === "brutal") {
    return (
      <section className={`${WRAP} py-4`}>
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
    <section className={`${WRAP} py-4`}>
      <div
        className="relative overflow-hidden p-5 text-white shadow-lg md:px-10 md:py-9"
        style={{
          borderRadius: theme.radius,
          background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
        }}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
        <p className="relative text-xs font-semibold uppercase tracking-wider opacity-90">
          Promo
        </p>
        <h2 className="relative mt-1 text-xl font-bold md:text-3xl">{theme.promoTitle}</h2>
        <p className="relative mt-1 text-sm opacity-90 md:text-base">{theme.promoSubtitle}</p>
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
            className={`${HEAD_WRAP} border px-4 py-3 backdrop-blur-xl`}
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
        <div className={`${HEAD_WRAP} flex items-center justify-between gap-3 px-4 md:px-6`}>
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
        <header className={`${WRAP} pb-3`}>
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
        <div className={WRAP}>
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

const ORDER_STEPS = [
  { icon: MousePointerClick, title: "Pick what you need", body: "Browse the shop and add items to your order." },
  { icon: CreditCard, title: "Check out with your mobile number", body: "No account to create. Add your address and choose how to pay." },
  { icon: PackageCheck, title: "Follow your order", body: "The shop confirms your payment and arranges delivery or pickup." },
] as const;

/** Shown while a shop has nothing to sell yet: explains ordering, and tells the owner what to do next. */
function EmptyShop({ tenant, isPreview }: { tenant: DemoTenant; isPreview: boolean }) {
  const theme = tenant.shopTheme;
  const canChat = tenant.storeSettings.shopAssistant.enabled || tenant.storeSettings.shopAssistant.humanInbox !== false;
  return (
    <section className={`${WRAP} py-10 md:py-14`} aria-labelledby="empty-shop-title">
      <div className="mx-auto max-w-xl text-center">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center"
          style={{ borderRadius: theme.radius, backgroundColor: `${theme.primaryColor}1f`, color: theme.primaryColor }}
        >
          <PackagePlus className="h-6 w-6" aria-hidden />
        </span>
        <h2 id="empty-shop-title" className="mt-4 text-xl font-bold md:text-2xl">
          {tenant.name} is getting ready to open
        </h2>
        <p className="mt-2 text-sm opacity-75 md:text-base">
          {canChat
            ? "Nothing is listed yet. Message the shop to ask what's available, or check back soon."
            : "Nothing is listed yet. Please check back soon."}
        </p>
        {isPreview && (
          <a
            href={`${adminUrl}/products?new=1`}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-semibold transition hover:opacity-90"
            style={{
              borderRadius: theme.radius,
              backgroundColor: theme.primaryColor,
              color: theme.mode === "dark" ? theme.foreground : "#fff",
            }}
          >
            <PackagePlus className="h-4 w-4" aria-hidden />
            Add your first product
          </a>
        )}
      </div>

      <ol className="mt-10 grid gap-3 md:grid-cols-3">
        {ORDER_STEPS.map((step, i) => (
          <li
            key={step.title}
            className="border p-4 md:p-5"
            style={{ borderRadius: theme.radius, borderColor: theme.border, backgroundColor: theme.cardBackground }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center"
                style={{ borderRadius: theme.radius, backgroundColor: `${theme.primaryColor}1f`, color: theme.primaryColor }}
              >
                <step.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider opacity-60">Step {i + 1}</span>
            </div>
            <p className="mt-3 text-sm font-bold">{step.title}</p>
            <p className="mt-1 text-sm opacity-75">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ThemedStorefrontHome({
  tenant,
  utmLabel,
  isPreview = false,
}: {
  tenant: DemoTenant;
  utmLabel?: string;
  isPreview?: boolean;
}) {
  const theme = tenant.shopTheme;
  const categories = [...new Set(tenant.products.map((p) => p.category))];
  const gridLayout = theme.card === "grid" || theme.layout === "bento" || theme.card === "magazine";

  return (
    <StorefrontThemeShell theme={theme} className="min-h-screen pb-28">
      <StoreHeaderThemed tenant={tenant} />

      {utmLabel && (
        <div className={`${WRAP} pt-3`}>
          <Badge variant="social" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Welcome from {utmLabel}!
          </Badge>
        </div>
      )}

      <PromoBanner tenant={tenant} />

      <PremiumStorefrontSections tenant={tenant} />

      {categories.length > 0 && (
        <div className={`${WRAP} overflow-x-auto pb-2`}>
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
        <EmptyShop tenant={tenant} isPreview={isPreview} />
      ) : (
        categories.map((category) => (
          <section key={category} className={`${WRAP} py-3`}>
            <h2 className="mb-3 text-base font-bold">{category}</h2>
            <div className={gridLayout ? "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" : "grid gap-3 md:grid-cols-2 lg:grid-cols-3"}>
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

      {isPreview && (
        <section className={`${WRAP} py-6`}>
          <div
            className="border border-dashed p-5 text-center"
            style={{
              borderRadius: theme.radius,
              borderColor: `${theme.primaryColor}55`,
              backgroundColor: `${theme.primaryColor}11`,
            }}
          >
            <p className="text-sm font-medium">Your shop link (owner preview only)</p>
            <code
              className="mx-auto mt-2 block max-w-xl truncate px-3 py-2.5 text-xs"
              style={{
                borderRadius: theme.radius,
                backgroundColor: theme.cardBackground,
                color: theme.primaryColor,
              }}
            >
              {shopPublicUrl(tenant.slug)}
            </code>
          </div>
        </section>
      )}

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
