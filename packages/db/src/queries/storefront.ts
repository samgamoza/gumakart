import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { categories, productImages, productVariants, products, tenants } from "../schema/index";

export interface StorefrontTenantRecord {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  themeJson: {
    primaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    templateId?: string;
    tagline?: string;
    promoTitle?: string;
    promoSubtitle?: string;
  } | null;
  currency: string;
  subscriptionPlan: string | null;
  settingsJson: import("../types/tenant-settings").TenantSettingsJson | null;
  seoPublishedJson: import("../types/tenant-seo").TenantSeoJson | null;
  checkoutPublishedJson: import("../types/tenant-checkout").TenantCheckoutJson | null;
  shippingPublishedJson: import("../types/tenant-shipping").TenantShippingJson | null;
  products: Array<{
    id: string;
    slug: string;
    title: string;
    descriptionHtml: string | null;
    basePrice: string;
    compareAtPrice: string | null;
    status: string;
    isMain: boolean;
    imageUrl: string | null;
    categoryName: string | null;
    categorySlug: string | null;
    metadataJson: {
      unitType?: "pc" | "box" | "other";
      unitCustom?: string;
      servicePriceStyle?: "base_minimum" | "value_range";
    } | null;
    /** Phase 9: product options (Size, Color…). Empty for simple products. */
    options: Array<{ name: string; values: string[] }>;
    /** Active variants in display order. Only filled when the product has options. */
    variants: StorefrontVariant[];
  }>;
  shopCategories: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

export interface StorefrontVariant {
  id: string;
  title: string;
  options: Record<string, string>;
  price: string;
  compareAtPrice: string | null;
  imageUrl: string | null;
  /** In stock (or the product doesn't track inventory). */
  available: boolean;
}

export interface PendingTenantRecord {
  slug: string;
  name: string;
  status: string;
}

/** Pending Launch shops only — suspended tenants use getTenantAvailabilityBySlug. */
export async function getPendingTenantBySlug(
  slug: string
): Promise<PendingTenantRecord | null> {
  const availability = await getTenantAvailabilityBySlug(slug);
  if (!availability || availability.status !== "pending") return null;
  return availability;
}

/** Lightweight public status lookup for storefront / checkout gates. */
export async function getTenantAvailabilityBySlug(
  slug: string
): Promise<PendingTenantRecord | null> {
  const db = getDb();
  const [tenant] = await db
    .select({
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  return tenant ?? null;
}

export async function getTenantStatusById(tenantId: string): Promise<string | null> {
  const db = getDb();
  const [tenant] = await db
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.status ?? null;
}

export async function getTenantStorefrontBySlug(
  slug: string
): Promise<StorefrontTenantRecord | null> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status !== "active") return null;

  return mapStorefrontTenant(tenant);
}

/** Draft/preview access for Launch — allows pending shops to preview before activate. */
export async function getTenantStorefrontPreviewBySlug(
  slug: string
): Promise<StorefrontTenantRecord | null> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || (tenant.status !== "active" && tenant.status !== "pending")) return null;

  return mapStorefrontTenant(tenant, { preferDraft: true });
}

async function firstShopPhoto(
  tenantId: string,
  catalog: Array<{ id: string; status: string | null; imageUrl: string | null }>
): Promise<string | null> {
  const active = catalog.filter((p) => p.status === "active");
  const withVariantImage = active.find((p) => p.imageUrl);
  if (withVariantImage?.imageUrl) return withVariantImage.imageUrl;
  if (active.length === 0) return null;
  const db = getDb();
  const [img] = await db
    .select({ url: productImages.url })
    .from(productImages)
    .innerJoin(products, eq(productImages.productId, products.id))
    .where(and(eq(products.tenantId, tenantId), eq(products.status, "active")))
    .orderBy(desc(products.isMain), asc(productImages.sortOrder))
    .limit(1);
  return img?.url ?? null;
}

async function mapStorefrontTenant(
  tenant: typeof tenants.$inferSelect,
  options?: { preferDraft?: boolean }
): Promise<StorefrontTenantRecord> {
  const db = getDb();
  const catalogRows = await db
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      descriptionHtml: products.descriptionHtml,
      basePrice: products.basePrice,
      compareAtPrice: products.compareAtPrice,
      status: products.status,
      isMain: products.isMain,
      metadataJson: products.metadataJson,
      optionsJson: products.optionsJson,
      trackInventory: products.trackInventory,
      imageUrl: productVariants.imageUrl,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(products)
    .leftJoin(
      productVariants,
      and(eq(productVariants.productId, products.id), eq(productVariants.active, true))
    )
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.tenantId, tenant.id))
    .orderBy(desc(products.isMain), desc(products.createdAt), asc(productVariants.position), asc(productVariants.id));

  // Variant join can duplicate rows — keep the first (default) variant per product.
  const seen = new Set<string>();
  const catalog = catalogRows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  // Phase 9: variants for products that have options (one query for the shop).
  const withOptions = catalog.filter((p) => (p.optionsJson?.length ?? 0) > 0);
  const variantsByProduct = new Map<string, StorefrontVariant[]>();
  if (withOptions.length > 0) {
    const tracks = new Map(withOptions.map((p) => [p.id, p.trackInventory !== false]));
    const rows = await db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        title: productVariants.title,
        options: productVariants.optionsJson,
        price: productVariants.price,
        compareAtPrice: productVariants.compareAtPrice,
        imageUrl: productVariants.imageUrl,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, withOptions.map((p) => p.id)), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.position), asc(productVariants.id));
    for (const row of rows) {
      const list = variantsByProduct.get(row.productId) ?? [];
      list.push({
        id: row.id,
        title: row.title,
        options: row.options ?? {},
        price: row.price,
        compareAtPrice: row.compareAtPrice,
        imageUrl: row.imageUrl,
        available: !tracks.get(row.productId) || (row.stockQty ?? 0) > 0,
      });
      variantsByProduct.set(row.productId, list);
    }
  }

  const shopCategories = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
    })
    .from(categories)
    .where(eq(categories.tenantId, tenant.id));

  const themeJson = options?.preferDraft
    ? tenant.themeDraftJson ?? tenant.themePublishedJson ?? tenant.themeJson
    : tenant.themePublishedJson ?? tenant.themeJson;

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    category: tenant.category,
    // Template heroes use coverUrl first. Without a cover photo, show the shop's own
    // product photo instead of the template's stock image (a beauty shop on a
    // fashion template used to get a clothing banner).
    coverUrl: tenant.coverUrl || (await firstShopPhoto(tenant.id, catalog)),
    logoUrl: tenant.logoUrl,
    themeJson,
    currency: tenant.currency,
    subscriptionPlan: tenant.subscriptionPlan,
    settingsJson: tenant.settingsJson,
    seoPublishedJson: tenant.seoPublishedJson ?? null,
    checkoutPublishedJson: tenant.checkoutPublishedJson ?? null,
    shippingPublishedJson: tenant.shippingPublishedJson ?? null,
    products: catalog.map(({ optionsJson, trackInventory: _track, ...p }) => ({
      ...p,
      isMain: Boolean(p.isMain),
      metadataJson: p.metadataJson ?? null,
      options: optionsJson ?? [],
      variants: variantsByProduct.get(p.id) ?? [],
    })),
    shopCategories,
  };
}
