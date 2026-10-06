import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../client";
import { recordStockMovement } from "./stock-ledger";
import { orderItems, productImages, productVariants, products } from "../schema/index";

export type ProductMetadataJson = {
  prepTimeMinutes?: number;
  allergens?: string[];
  unitType?: "pc" | "box" | "other";
  unitCustom?: string;
  servicePriceStyle?: "base_minimum" | "value_range";
};

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  basePrice: string;
  compareAtPrice: string | null;
  descriptionHtml: string | null;
  status: string;
  stockQty: number;
  aiGenerated: boolean;
  imageUrl: string | null;
  isMain: boolean;
  metadataJson: ProductMetadataJson | null;
  createdAt: Date;
  /** Phase 9: options like Size × Color; stockQty is then the total across variants. */
  hasOptions: boolean;
  variantCount: number;
  lowestVariantStock: number;
}

export interface CreateProductInput {
  title: string;
  slug: string;
  descriptionHtml?: string;
  basePrice: string;
  compareAtPrice?: string;
  status?: "draft" | "active";
  stockQty?: number;
  aiGenerated?: boolean;
  imageUrl?: string;
  isMain?: boolean;
  metadataJson?: ProductMetadataJson | null;
}

function normalizeProductSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function slugFromProductTitle(title: string): string {
  return normalizeProductSlug(title);
}

async function clearOtherMainProducts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { update: (...args: any[]) => any },
  tenantId: string,
  keepProductId: string
): Promise<void> {
  await tx
    .update(products)
    .set({ isMain: false, updatedAt: new Date() })
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.isMain, true),
        ne(products.id, keepProductId)
      )
    );
}

export async function listProductsForTenant(tenantId: string): Promise<ProductListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      basePrice: products.basePrice,
      compareAtPrice: products.compareAtPrice,
      descriptionHtml: products.descriptionHtml,
      status: products.status,
      aiGenerated: products.aiGenerated,
      isMain: products.isMain,
      metadataJson: products.metadataJson,
      createdAt: products.createdAt,
      stockQty: productVariants.stockQty,
      imageUrl: productVariants.imageUrl,
      optionsJson: products.optionsJson,
    })
    .from(products)
    .leftJoin(
      productVariants,
      and(eq(productVariants.productId, products.id), eq(productVariants.active, true))
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(desc(products.isMain), desc(products.createdAt), asc(productVariants.position), asc(productVariants.id));

  // One row per active variant; the first (position, id) is the default variant —
  // the one checkout charges for products without options.
  const seen = new Map<string, ProductListItem>();
  const items: ProductListItem[] = [];
  for (const row of rows) {
    const existing = seen.get(row.id);
    if (existing) {
      existing.variantCount += 1;
      existing.stockQty += row.stockQty ?? 0;
      existing.lowestVariantStock = Math.min(existing.lowestVariantStock, row.stockQty ?? 0);
      continue;
    }
    const hasOptions = Array.isArray(row.optionsJson) && row.optionsJson.length > 0;
    const item: ProductListItem = {
      id: row.id,
      title: row.title,
      slug: row.slug,
      basePrice: row.basePrice,
      compareAtPrice: row.compareAtPrice ?? null,
      descriptionHtml: row.descriptionHtml ?? null,
      status: row.status,
      stockQty: row.stockQty ?? 0,
      aiGenerated: row.aiGenerated ?? false,
      imageUrl: row.imageUrl ?? null,
      isMain: Boolean(row.isMain),
      metadataJson: (row.metadataJson as ProductMetadataJson | null) ?? null,
      createdAt: row.createdAt,
      hasOptions,
      variantCount: 1,
      lowestVariantStock: row.stockQty ?? 0,
    };
    seen.set(row.id, item);
    items.push(item);
  }
  return items;
}

export async function getProductForTenant(
  tenantId: string,
  productId: string
): Promise<ProductListItem | null> {
  const items = await listProductsForTenant(tenantId);
  return items.find((p) => p.id === productId) ?? null;
}

export async function createProductForTenant(
  tenantId: string,
  input: CreateProductInput
): Promise<ProductListItem> {
  const db = getDb();
  const baseSlug = normalizeProductSlug(input.slug || slugFromProductTitle(input.title));
  let slug = baseSlug;
  let suffix = 2;
  while (!(await isProductSlugAvailable(tenantId, slug))) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const status = input.status ?? "active";
  const stockQty = input.stockQty ?? 10;

  const [{ count: existingCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.tenantId, tenantId));

  // First product becomes the identity product unless seller opts out.
  const isMain = input.isMain ?? existingCount === 0;

  const product = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(products)
      .values({
        tenantId,
        title: input.title.trim(),
        slug,
        descriptionHtml: input.descriptionHtml?.trim() || `<p>${input.title.trim()}</p>`,
        status,
        basePrice: input.basePrice,
        compareAtPrice: input.compareAtPrice,
        aiGenerated: input.aiGenerated ?? false,
        isMain,
        metadataJson: input.metadataJson ?? null,
      })
      .returning();

    if (!created) throw new Error("Failed to create product");

    if (isMain) {
      await clearOtherMainProducts(tx, tenantId, created.id);
    }

    const [variant] = await tx
      .insert(productVariants)
      .values({
        productId: created.id,
        sku: `${slug}-default`,
        title: "Default",
        price: input.basePrice,
        stockQty,
        optionsJson: { variant: "Default" },
        imageUrl: input.imageUrl,
      })
      .returning();

    if (!variant) throw new Error("Failed to create product variant");

    if (created.trackInventory !== false) {
      await recordStockMovement(tx, {
        tenantId,
        variantId: variant.id,
        reason: "initial",
        delta: stockQty,
        balanceAfter: stockQty,
        note: "Product created",
      });
    }

    if (input.imageUrl) {
      await tx.insert(productImages).values({
        productId: created.id,
        variantId: variant.id,
        url: input.imageUrl,
        alt: created.title,
        sortOrder: 0,
      });
    }

    return created;
  });

  if (status === "active") {
    const { tryAutoActivateTenant } = await import("./tenant-dashboard");
    await tryAutoActivateTenant(tenantId);
  }

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice ?? null,
    descriptionHtml: product.descriptionHtml ?? null,
    status: product.status,
    stockQty,
    aiGenerated: product.aiGenerated ?? false,
    imageUrl: input.imageUrl ?? null,
    isMain: Boolean(product.isMain),
    metadataJson: (product.metadataJson as ProductMetadataJson | null) ?? null,
    createdAt: product.createdAt,
    hasOptions: false,
    variantCount: 1,
    lowestVariantStock: stockQty,
  };
}

export interface UpdateProductInput {
  title?: string;
  descriptionHtml?: string;
  basePrice?: string;
  compareAtPrice?: string | null;
  status?: "draft" | "active" | "archived";
  stockQty?: number;
  imageUrl?: string | null;
  isMain?: boolean;
  metadataJson?: ProductMetadataJson | null;
}

export async function updateProductForTenant(
  tenantId: string,
  productId: string,
  input: UpdateProductInput
): Promise<boolean> {
  const db = getDb();

  return db
    .transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id, optionsJson: products.optionsJson })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
        .limit(1);
      if (!product) return false;
      // Products with options take price and stock per variant (saveProductVariants);
      // base_price there follows the cheapest variant, so ignore a stray edit.
      const productHasOptions = (product.optionsJson?.length ?? 0) > 0;

      if (input.isMain === true) {
        await clearOtherMainProducts(tx, tenantId, productId);
      }

      await tx
        .update(products)
        .set({
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.descriptionHtml !== undefined
            ? { descriptionHtml: input.descriptionHtml }
            : {}),
          ...(input.basePrice !== undefined && !productHasOptions ? { basePrice: input.basePrice } : {}),
          ...(input.compareAtPrice !== undefined
            ? { compareAtPrice: input.compareAtPrice }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.isMain !== undefined ? { isMain: input.isMain } : {}),
          ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));

      // Keep the default (first active) variant in sync for price/stock/image —
      // only for products without options (those are edited per variant).
      // Locked so a checkout can't sell between reading the old count and
      // writing the new one (the ledger delta would be wrong).
      const [variant] = await tx
        .select({ id: productVariants.id, stockQty: productVariants.stockQty, hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0` })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(productVariants.productId, productId), eq(productVariants.active, true)))
        .orderBy(asc(productVariants.position), asc(productVariants.id))
        .limit(1)
        .for("update", { of: productVariants });

      if (variant && variant.hasOptions && input.imageUrl !== undefined) {
        // The product photo still lives on the first variant.
        await tx.update(productVariants).set({ imageUrl: input.imageUrl }).where(eq(productVariants.id, variant.id));
      }
      // Title/description/status-only edits have nothing to set on the variant (Phase 18 fix:
      // an empty .set() threw "No values to set").
      const variantSet = {
        ...(input.basePrice !== undefined ? { price: input.basePrice } : {}),
        ...(input.stockQty !== undefined ? { stockQty: input.stockQty } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      };
      if (variant && !variant.hasOptions && Object.keys(variantSet).length > 0) {
        await tx.update(productVariants).set(variantSet).where(eq(productVariants.id, variant.id));

        if (input.stockQty !== undefined) {
          await recordStockMovement(tx, {
            tenantId,
            variantId: variant.id,
            reason: "adjustment",
            delta: input.stockQty - (variant.stockQty ?? 0),
            balanceAfter: input.stockQty,
            note: "Stock edited by seller",
          });
        }
      }

      if (input.imageUrl) {
        const [image] = await tx
          .select({ id: productImages.id })
          .from(productImages)
          .where(eq(productImages.productId, productId))
          .limit(1);
        if (image) {
          await tx
            .update(productImages)
            .set({ url: input.imageUrl })
            .where(eq(productImages.id, image.id));
        } else {
          await tx.insert(productImages).values({
            productId,
            variantId: variant?.id,
            url: input.imageUrl,
            sortOrder: 0,
          });
        }
      }

      return true;
    })
    .then(async (ok) => {
      if (!ok) return false;
      if (input.status === "active" || input.status === undefined) {
        const { tryAutoActivateTenant } = await import("./tenant-dashboard");
        await tryAutoActivateTenant(tenantId);
      }
      return true;
    });
}

export type DeleteProductResult = "deleted" | "archived" | "not_found";

/**
 * Hard-deletes a product when nothing references it. Products that appear in
 * past orders are archived instead (order_items.product_id has no cascade),
 * which also hides them from the storefront.
 */
export async function deleteProductForTenant(
  tenantId: string,
  productId: string
): Promise<DeleteProductResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: products.id, isMain: products.isMain })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
      .limit(1);
    if (!product) return "not_found";

    const [referenced] = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.productId, productId))
      .limit(1);

    if (referenced) {
      await tx
        .update(products)
        .set({ status: "archived", isMain: false, updatedAt: new Date() })
        .where(eq(products.id, productId));
      return "archived";
    }

    // product_images.variant_id references product_variants without a cascade,
    // so remove images first, then variants, then the product row.
    await tx.delete(productImages).where(eq(productImages.productId, productId));
    await tx.delete(productVariants).where(eq(productVariants.productId, productId));
    await tx.delete(products).where(eq(products.id, productId));
    return "deleted";
  });
}

export async function isProductSlugAvailable(tenantId: string, slug: string): Promise<boolean> {
  const db = getDb();
  const normalized = normalizeProductSlug(slug);
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.slug, normalized)))
    .limit(1);

  return existing.length === 0;
}

export { normalizeProductSlug };
