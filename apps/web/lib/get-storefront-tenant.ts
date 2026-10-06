import { resolveShopThemeForPlan, resolveStorePattern, emojiForShopCategory } from "@gumakart/storefront-themes";
import {
  classifyTenantPublicAccess,
  getPendingTenantBySlug,
  getTenantAvailabilityBySlug,
  getTenantStorefrontBySlug,
  getTenantStorefrontPreviewBySlug,
} from "@gumakart/db";
import {
  DEMO_TENANT,
  type DemoProduct,
  type DemoTenant,
  getTenant as getDemoTenant,
} from "./demo-data";
import { getModelStoreTenant, MODEL_STORE_SLUG } from "./model-store-tenant";
import { resolveStorefrontSettings } from "./storefront-settings";

function mapDbTenantToDemo(
  tenant: NonNullable<Awaited<ReturnType<typeof getTenantStorefrontBySlug>>>
): DemoTenant {
  const mappedProducts: DemoProduct[] = tenant.products
    .filter((product) => product.status === "active")
    .map((product) => ({
      id: product.id,
      slug: product.slug,
      title: product.title,
      shortDescription: product.descriptionHtml?.replace(/<[^>]+>/g, "") ?? "",
      price: Number(product.basePrice),
      compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : undefined,
      image: product.imageUrl ?? "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80",
      category: product.categoryName ?? tenant.category ?? "Products",
      categorySlug: product.categorySlug ?? undefined,
      isMain: Boolean(product.isMain),
      tags: product.isMain ? ["featured", "bestseller"] : [],
      ...(product.rating ? { rating: product.rating } : {}),
      available: product.available,
      ...(product.preorderShipDate ? { preorderShipDate: product.preorderShipDate } : {}),
      pricingMeta: product.metadataJson
        ? {
            unitType: product.metadataJson.unitType,
            unitCustom: product.metadataJson.unitCustom,
            servicePriceStyle: product.metadataJson.servicePriceStyle,
          }
        : undefined,
      ...(product.options.length > 0 && product.variants.length > 0
        ? {
            options: product.options,
            variants: product.variants.map((v) => ({
              id: v.id,
              title: v.title,
              options: v.options,
              price: Number(v.price),
              compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
              image: v.imageUrl ?? undefined,
              available: v.available,
            })),
          }
        : {}),
    }))
    .sort((a, b) => Number(Boolean(b.isMain)) - Number(Boolean(a.isMain)));

  const shopTheme = resolveShopThemeForPlan(
    tenant.themeJson,
    tenant.name,
    tenant.subscriptionPlan
  );
  const storeSettings = resolveStorefrontSettings(
    tenant.settingsJson,
    tenant.currency ?? "PHP",
    tenant.checkoutPublishedJson,
    tenant.shippingPublishedJson
  );
  const patternId = resolveStorePattern(tenant.themeJson);

  return {
    slug: tenant.slug,
    name: tenant.name,
    tagline: shopTheme.tagline,
    category: tenant.category ?? "General",
    location: "Philippines",
    logoEmoji: emojiForShopCategory(tenant.category),
    logoUrl: tenant.logoUrl ?? undefined,
    theme: {
      primaryColor: shopTheme.primaryColor,
      accentColor: shopTheme.accentColor,
    },
    shopTheme,
    patternId,
    shopCategories: tenant.shopCategories,
    coverUrl: tenant.coverUrl ?? undefined,
    codEnabled: storeSettings.codEnabled,
    storeSettings,
    products: mappedProducts,
    ...(tenant.rating ? { rating: tenant.rating } : {}),
    subscriptionPlan: tenant.subscriptionPlan,
    seo: tenant.seoPublishedJson ?? null,
  };
}

export async function getStorefrontTenant(slug: string): Promise<DemoTenant | null> {
  if (slug === MODEL_STORE_SLUG) return getModelStoreTenant();

  // Real shops win over built-in demos, so a demo can never shadow a merchant.
  const tenant = await getTenantStorefrontBySlug(slug);
  if (tenant) return mapDbTenantToDemo(tenant);

  return getDemoTenant(slug) ?? null;
}

/** Launch / Shop Builder preview — includes pending shops + draft theme. */
export async function getStorefrontTenantPreview(slug: string): Promise<DemoTenant | null> {
  if (slug === MODEL_STORE_SLUG) return getModelStoreTenant();

  const tenant = await getTenantStorefrontPreviewBySlug(slug);
  if (tenant) return mapDbTenantToDemo(tenant);

  return getDemoTenant(slug) ?? null;
}

export async function getStorefrontProduct(
  tenantSlug: string,
  productSlug: string
): Promise<{ tenant: DemoTenant; product: DemoProduct } | null> {
  const tenant = await getStorefrontTenant(tenantSlug);
  if (!tenant) return null;

  const product = tenant.products.find((item) => item.slug === productSlug);
  if (!product) return null;

  return { tenant, product };
}

export async function getPendingStorefrontTenant(
  slug: string
): Promise<{ slug: string; name: string } | null> {
  if (getDemoTenant(slug)) return null;

  const pending = await getPendingTenantBySlug(slug);
  if (!pending) return null;

  return { slug: pending.slug, name: pending.name };
}

export async function getUnavailableStorefrontTenant(
  slug: string
): Promise<{ slug: string; name: string; kind: "pending" | "suspended" | "unavailable"; message: string } | null> {
  if (getDemoTenant(slug)) return null;

  const availability = await getTenantAvailabilityBySlug(slug);
  if (!availability || availability.status === "active") return null;

  const access = classifyTenantPublicAccess(availability.status);
  if (access.kind === "live") return null;

  return {
    slug: availability.slug,
    name: availability.name,
    kind: access.kind === "pending" ? "pending" : access.kind === "suspended" ? "suspended" : "unavailable",
    message:
      access.kind === "pending" || access.kind === "suspended" || access.kind === "unavailable"
        ? access.buyerMessage
        : "Shop not found.",
  };
}

/** @deprecated Use getStorefrontTenant in server components */
export { DEMO_TENANT };
