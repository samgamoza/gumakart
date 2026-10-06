"use client";

import { useMemo, useState } from "react";
import type { DemoTenant } from "@/lib/demo-data";
import { buildTenantV0Catalog } from "@/lib/tenant-v0-catalog";
import { FeaturedProducts } from "@/components/v0-store/featured-products";
import { TodaysDeals } from "@/components/v0-store/todays-deals";
import { NewArrivals } from "@/components/v0-store/new-arrivals";
import { LiveSelling } from "@/components/v0-store/live-selling";
import { PopularProducts } from "@/components/v0-store/popular-products";
import { CustomerReviews } from "@/components/v0-store/customer-reviews";
import { SiteFooter } from "@/components/v0-store/site-footer";
import { MessengerWidget } from "@/components/v0-store/messenger-widget";
import { upgradeUrl } from "@/lib/storefront-plans";
import { ShopAssistant } from "@/components/storefront/shop-assistant";
import { FeatureGate } from "@/components/storefront/premium/feature-gate";
import { TenantCartProvider, useTenantV0Cart } from "./tenant-cart-provider";
import { TenantCheckoutDrawer } from "./tenant-checkout-drawer";
import { TenantV0Header } from "./tenant-v0-header";
import { TenantV0Hero } from "./tenant-v0-hero";
import "@/app/model/v0-theme.css";

function filterCatalog(
  catalog: ReturnType<typeof buildTenantV0Catalog>,
  query: string
) {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;
  const match = (name: string) => name.toLowerCase().includes(q);
  const filterList = (list: typeof catalog.all) => list.filter((p) => match(p.name));
  return {
    ...catalog,
    all: filterList(catalog.all),
    featured: filterList(catalog.featured),
    deals: filterList(catalog.deals),
    newArrivals: filterList(catalog.newArrivals),
    popular: filterList(catalog.popular),
  };
}

function TenantV0StoreBody({ tenant }: { tenant: DemoTenant }) {
  const [search, setSearch] = useState("");
  const { add } = useTenantV0Cart();
  const catalog = useMemo(() => {
    const base = buildTenantV0Catalog(tenant);
    return filterCatalog(base, search);
  }, [tenant, search]);

  const theme = tenant.shopTheme;

  return (
    <div
      className="v0-store-root light min-h-screen bg-background font-sans antialiased"
      style={
        {
          "--primary": theme.primaryColor,
          "--accent": theme.accentColor,
        } as React.CSSProperties
      }
    >
      <TenantV0Header
        shopName={tenant.name}
        shopSlug={tenant.slug}
        logoUrl={tenant.logoUrl}
        logoEmoji={tenant.logoEmoji}
        categories={catalog.categories}
        search={search}
        onSearchChange={setSearch}
      />
      <main>
        <TenantV0Hero
          eyebrow={`${tenant.category} · AI-powered store`}
          headline={tenant.tagline}
          subcopy={`${theme.promoTitle}. ${theme.promoSubtitle}`}
          spotlight={catalog.featured[0] ?? catalog.all[0] ?? null}
          onAdd={add}
        />
        <FeaturedProducts
          items={catalog.featured}
          onAdd={add}
          subtitle={`Top picks from ${tenant.name}`}
        />
        <TodaysDeals items={catalog.deals} onAdd={add} />
        <NewArrivals items={catalog.newArrivals} onAdd={add} />
        <FeatureGate
          required="growth"
          plan={tenant.subscriptionPlan}
          theme={theme}
          upgradeHref={upgradeUrl("growth")}
          teaser={
            <LiveSelling
              product={catalog.liveProduct}
              shopName={tenant.name}
              onAdd={add}
            />
          }
        >
          <LiveSelling
            product={catalog.liveProduct}
            shopName={tenant.name}
            onAdd={add}
          />
        </FeatureGate>
        <PopularProducts items={catalog.popular} onAdd={add} />
        <CustomerReviews items={catalog.reviews} />
      </main>
      <SiteFooter />
      {(tenant.storeSettings.shopAssistant.enabled || tenant.storeSettings.shopAssistant.humanInbox !== false) && (
        <ShopAssistant
          tenantSlug={tenant.slug}
          shopName={tenant.name}
          assistant={tenant.storeSettings.shopAssistant}
        />
      )}
      <MessengerWidget />
      <TenantCheckoutDrawer storeSettings={tenant.storeSettings} />
    </div>
  );
}

export function StorefrontExperience({
  tenant,
}: {
  tenant: DemoTenant;
  activeCategorySlug?: string;
}) {
  return (
    <TenantCartProvider tenantSlug={tenant.slug}>
      <TenantV0StoreBody tenant={tenant} />
    </TenantCartProvider>
  );
}
