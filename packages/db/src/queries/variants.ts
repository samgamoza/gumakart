import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import { productVariants, products } from "../schema/index";
import { recordStockMovement } from "./stock-ledger";

/**
 * Phase 9 — product options and variants (Size × Color × …).
 *
 * Rules
 *  - A product with no options has exactly one active variant ("Default").
 *  - Up to 3 options, up to 20 values each, up to 100 variants.
 *  - Each active variant has one value per option and the combination is unique.
 *  - Variants are never hard-deleted (past orders, links and the stock ledger point at
 *    them): removing one turns it off (active = false).
 *  - Every stock change writes a ledger row in the same transaction.
 *  - products.base_price follows the cheapest active variant (listings show "from ₱X").
 *
 * The "default variant" everywhere else = first ACTIVE variant by (position, id).
 */

export const MAX_OPTIONS = 3;
export const MAX_OPTION_VALUES = 20;
export const MAX_VARIANTS = 100;

export interface ProductOption {
  name: string;
  values: string[];
}

export interface VariantRow {
  id: string;
  title: string;
  options: Record<string, string>;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  barcode: string | null;
  stockQty: number;
  imageUrl: string | null;
  active: boolean;
  position: number;
}

export interface ProductVariantsView {
  productId: string;
  title: string;
  trackInventory: boolean;
  options: ProductOption[];
  variants: VariantRow[];
}

export interface VariantInput {
  id?: string | null;
  options: Record<string, string>;
  price: number;
  compareAtPrice?: number | null;
  sku?: string | null;
  barcode?: string | null;
  stockQty: number;
  imageUrl?: string | null;
}

export class VariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VariantError";
  }
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/** "M / Red" from option order. */
export function variantTitleOf(options: ProductOption[], values: Record<string, string>): string {
  if (options.length === 0) return "Default";
  return options.map((o) => values[o.name] ?? "").join(" / ");
}

/** Every combination of option values, in option order. */
export function combinationsOf(options: ProductOption[]): Array<Record<string, string>> {
  let combos: Array<Record<string, string>> = [{}];
  for (const option of options) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) for (const value of option.values) next.push({ ...combo, [option.name]: value });
    combos = next;
  }
  return options.length === 0 ? [] : combos;
}

export function normalizeOptions(raw: ProductOption[]): ProductOption[] {
  if (raw.length > MAX_OPTIONS) throw new VariantError(`Up to ${MAX_OPTIONS} options (e.g. Size, Color, Material).`);
  const names = new Set<string>();
  return raw.map((o) => {
    const name = clean(o.name).slice(0, 40);
    if (!name) throw new VariantError("Give each option a name, e.g. Size.");
    if (names.has(name.toLowerCase())) throw new VariantError(`"${name}" is listed twice.`);
    names.add(name.toLowerCase());
    const seen = new Set<string>();
    const values: string[] = [];
    for (const v of o.values) {
      const value = clean(v).slice(0, 60);
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      values.push(value);
    }
    if (values.length === 0) throw new VariantError(`Add at least one value for ${name}.`);
    if (values.length > MAX_OPTION_VALUES) throw new VariantError(`Up to ${MAX_OPTION_VALUES} values for ${name}.`);
    return { name, values };
  });
}

function toMoney(n: number, label: string): string {
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new VariantError(`Check the ${label}.`);
  return (Math.round(n * 100) / 100).toFixed(2);
}

export async function getProductVariantsForTenant(tenantId: string, productId: string): Promise<ProductVariantsView | null> {
  const db = getDb();
  const [product] = await db
    .select({ id: products.id, title: products.title, trackInventory: products.trackInventory, optionsJson: products.optionsJson })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (!product) return null;
  const rows = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position), asc(productVariants.id));
  const options = (product.optionsJson ?? []) as ProductOption[];
  return {
    productId: product.id,
    title: product.title,
    trackInventory: product.trackInventory !== false,
    options,
    variants: rows.map((v) => ({
      id: v.id,
      title: v.title,
      options: options.length === 0 ? {} : ((v.optionsJson ?? {}) as Record<string, string>),
      price: v.price,
      compareAtPrice: v.compareAtPrice ?? null,
      sku: v.sku,
      barcode: v.barcode,
      stockQty: v.stockQty ?? 0,
      imageUrl: v.imageUrl,
      active: v.active,
      position: v.position,
    })),
  };
}

/**
 * Replaces a product's options and variants. Variants in `input.variants` with an id are
 * updated, without one are created; any other active variant is turned off.
 */
export async function saveProductVariants(
  tenantId: string,
  productId: string,
  input: { options: ProductOption[]; variants: VariantInput[] },
  actorId?: string | null
): Promise<ProductVariantsView> {
  const options = normalizeOptions(input.options);
  if (input.variants.length === 0) throw new VariantError("Keep at least one variant.");
  if (input.variants.length > MAX_VARIANTS) throw new VariantError(`Up to ${MAX_VARIANTS} variants per product.`);
  if (options.length === 0 && input.variants.length !== 1) {
    throw new VariantError("A product without options has one price and stock. Add an option (e.g. Size) for more.");
  }

  const seenCombos = new Set<string>();
  const prepared = input.variants.map((v) => {
    const values: Record<string, string> = {};
    for (const option of options) {
      const value = clean(v.options?.[option.name] ?? "");
      const match = option.values.find((x) => x.toLowerCase() === value.toLowerCase());
      if (!match) throw new VariantError(`Pick a ${option.name} for every variant.`);
      values[option.name] = match;
    }
    const key = options.map((o) => values[o.name]!.toLowerCase()).join("\u0000");
    if (options.length > 0 && seenCombos.has(key)) {
      throw new VariantError(`"${variantTitleOf(options, values)}" is listed twice.`);
    }
    seenCombos.add(key);
    const stock = Math.trunc(Number(v.stockQty));
    if (!Number.isFinite(stock) || stock < 0 || stock > 1_000_000) throw new VariantError("Stock must be 0 or more.");
    return {
      id: v.id ?? null,
      values,
      title: variantTitleOf(options, values),
      price: toMoney(Number(v.price), "price"),
      compareAtPrice: v.compareAtPrice == null || v.compareAtPrice === 0 ? null : toMoney(Number(v.compareAtPrice), "compare-at price"),
      sku: v.sku?.trim().slice(0, 100) || null,
      barcode: v.barcode?.trim().replace(/\s+/g, "").slice(0, 64) || null,
      stockQty: stock,
      imageUrl: v.imageUrl?.trim() || null,
    };
  });

  const db = getDb();
  await db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: products.id, trackInventory: products.trackInventory })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
      .for("update");
    if (!product) throw new VariantError("Product not found.");

    const existing = await tx
      .select({ id: productVariants.id, stockQty: productVariants.stockQty, active: productVariants.active })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .for("update");
    const byId = new Map(existing.map((v) => [v.id, v]));

    // A shop's SKU must not collide with another active variant of the same shop.
    const skus = prepared.map((p) => p.sku).filter((s): s is string => Boolean(s));
    if (new Set(skus.map((s) => s.toLowerCase())).size !== skus.length) throw new VariantError("Two variants have the same SKU.");
    if (skus.length > 0) {
      const clash = await tx
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(products.tenantId, tenantId),
            sql`${productVariants.productId} <> ${productId}`,
            eq(productVariants.active, true),
            inArray(sql`lower(${productVariants.sku})`, skus.map((s) => s.toLowerCase()))
          )
        )
        .limit(1);
      if (clash[0]) throw new VariantError(`SKU "${clash[0].sku}" is already used by another product.`);
    }

    const keep = new Set<string>();
    for (const [index, v] of prepared.entries()) {
      if (v.id) {
        const current = byId.get(v.id);
        if (!current) throw new VariantError("A variant changed elsewhere — reload and try again.");
        keep.add(v.id);
        await tx
          .update(productVariants)
          .set({
            title: v.title,
            optionsJson: options.length === 0 ? { variant: "Default" } : v.values,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            sku: v.sku,
            barcode: v.barcode,
            stockQty: v.stockQty,
            imageUrl: v.imageUrl,
            active: true,
            position: index,
          })
          .where(eq(productVariants.id, v.id));
        const delta = v.stockQty - (current.stockQty ?? 0);
        if (delta !== 0 && product.trackInventory !== false) {
          await recordStockMovement(tx, {
            tenantId,
            variantId: v.id,
            reason: "adjustment",
            delta,
            balanceAfter: v.stockQty,
            actorId: actorId ?? null,
            note: "Variant stock edited",
          });
        }
      } else {
        const [created] = await tx
          .insert(productVariants)
          .values({
            productId,
            title: v.title,
            optionsJson: options.length === 0 ? { variant: "Default" } : v.values,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            sku: v.sku,
            barcode: v.barcode,
            stockQty: v.stockQty,
            imageUrl: v.imageUrl,
            active: true,
            position: index,
          })
          .returning({ id: productVariants.id });
        keep.add(created!.id);
        if (v.stockQty > 0 && product.trackInventory !== false) {
          await recordStockMovement(tx, {
            tenantId,
            variantId: created!.id,
            reason: "initial",
            delta: v.stockQty,
            balanceAfter: v.stockQty,
            actorId: actorId ?? null,
            note: "Variant added",
          });
        }
      }
    }

    const toDisable = existing.filter((v) => v.active && !keep.has(v.id)).map((v) => v.id);
    if (toDisable.length > 0) {
      await tx
        .update(productVariants)
        .set({ active: false, position: 1000 })
        .where(inArray(productVariants.id, toDisable));
    }

    const cheapest = prepared.reduce((min, v) => (Number(v.price) < Number(min.price) ? v : min), prepared[0]!);
    await tx
      .update(products)
      .set({
        optionsJson: options.length === 0 ? null : options,
        basePrice: cheapest.price,
        compareAtPrice: cheapest.compareAtPrice,
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));
  });

  return (await getProductVariantsForTenant(tenantId, productId))!;
}

/** Active variants for many products at once (storefront, POS, links). Ordered for display. */
export async function listActiveVariantsForProducts(productIds: string[]): Promise<
  Map<string, Array<{ id: string; title: string; options: Record<string, string>; price: number; compareAtPrice: number | null; stockQty: number; imageUrl: string | null; sku: string | null; barcode: string | null }>>
> {
  const map = new Map<string, Array<{ id: string; title: string; options: Record<string, string>; price: number; compareAtPrice: number | null; stockQty: number; imageUrl: string | null; sku: string | null; barcode: string | null }>>();
  if (productIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(productVariants)
    .where(and(inArray(productVariants.productId, productIds), eq(productVariants.active, true)))
    .orderBy(asc(productVariants.position), asc(productVariants.id));
  for (const v of rows) {
    const list = map.get(v.productId) ?? [];
    list.push({
      id: v.id,
      title: v.title,
      options: (v.optionsJson ?? {}) as Record<string, string>,
      price: Number(v.price),
      compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice),
      stockQty: v.stockQty ?? 0,
      imageUrl: v.imageUrl,
      sku: v.sku,
      barcode: v.barcode,
    });
    map.set(v.productId, list);
  }
  return map;
}
