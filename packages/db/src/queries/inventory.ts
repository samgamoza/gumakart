import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../client";
import { productVariants, products, tenants } from "../schema/index";
import type { TenantSettingsJson } from "../types/tenant-settings";
import { recordStockMovement } from "./stock-ledger";

/**
 * Phase 9 — stock tools: the inventory list, stock counts, CSV import/export
 * and low-stock alerts. Every stock change writes a ledger row ("adjustment")
 * in the same transaction as the counter it changes.
 */

export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export function lowStockThresholdOf(settings: TenantSettingsJson | null | undefined): number {
  const n = settings?.inventory?.lowStockThreshold;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : DEFAULT_LOW_STOCK_THRESHOLD;
}

export async function getLowStockThreshold(tenantId: string): Promise<number> {
  const [row] = await getDb().select({ settings: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return lowStockThresholdOf(row?.settings);
}

export interface InventoryRow {
  productId: string;
  productTitle: string;
  productSlug: string;
  productStatus: string;
  hasOptions: boolean;
  variantId: string;
  /** Null for products without options. */
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  price: string;
  stockQty: number;
}

/** Active variants of the shop's non-archived, stock-tracked products. */
export async function listInventory(
  tenantId: string,
  options: { lowAtOrBelow?: number | null } = {}
): Promise<InventoryRow[]> {
  const rows = await getDb()
    .select({
      productId: products.id,
      productTitle: products.title,
      productSlug: products.slug,
      productStatus: products.status,
      optionsJson: products.optionsJson,
      variantId: productVariants.id,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      barcode: productVariants.barcode,
      price: productVariants.price,
      stockQty: productVariants.stockQty,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(products.tenantId, tenantId),
        ne(products.status, "archived"),
        eq(productVariants.active, true),
        sql`coalesce(${products.trackInventory}, true)`,
        options.lowAtOrBelow != null ? sql`coalesce(${productVariants.stockQty}, 0) <= ${options.lowAtOrBelow}` : undefined
      )
    )
    .orderBy(asc(products.title), asc(productVariants.position), asc(productVariants.id));

  return rows.map((r) => {
    const hasOptions = (r.optionsJson?.length ?? 0) > 0;
    return {
      productId: r.productId,
      productTitle: r.productTitle,
      productSlug: r.productSlug,
      productStatus: r.productStatus,
      hasOptions,
      variantId: r.variantId,
      variantTitle: hasOptions ? r.variantTitle : null,
      sku: r.sku,
      barcode: r.barcode,
      price: r.price,
      stockQty: r.stockQty ?? 0,
    };
  });
}

export interface LowStockSummary {
  threshold: number;
  lowCount: number;
  soldOutCount: number;
  /** A few to show on the dashboard, lowest first. */
  items: Array<{ productId: string; title: string; stockQty: number }>;
}

export async function getLowStockSummary(tenantId: string): Promise<LowStockSummary> {
  const threshold = await getLowStockThreshold(tenantId);
  const low = (await listInventory(tenantId, { lowAtOrBelow: threshold })).filter((r) => r.productStatus === "active");
  low.sort((a, b) => a.stockQty - b.stockQty);
  return {
    threshold,
    lowCount: low.length,
    soldOutCount: low.filter((r) => r.stockQty <= 0).length,
    items: low.slice(0, 5).map((r) => ({
      productId: r.productId,
      title: r.variantTitle ? `${r.productTitle} (${r.variantTitle})` : r.productTitle,
      stockQty: r.stockQty,
    })),
  };
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface StockChange {
  variantId: string;
  stockQty?: number;
  /** New selling price (pesos). */
  price?: number;
}

export interface StockChangeResult {
  changed: number;
  unchanged: number;
}

/**
 * Applies counted stock (and optionally prices) to the shop's variants. Variants
 * that aren't the shop's are rejected as a whole — nothing is written.
 * products.base_price follows: simple products = their one variant's price,
 * products with options = the cheapest active variant.
 */
export async function applyStockChanges(
  tenantId: string,
  changes: StockChange[],
  options: { note: string; actorId?: string | null }
): Promise<StockChangeResult> {
  if (changes.length === 0) return { changed: 0, unchanged: 0 };
  if (changes.length > 2000) throw new InventoryError("Up to 2,000 rows at a time.");
  const byId = new Map<string, StockChange>();
  for (const c of changes) {
    if (c.stockQty !== undefined && (!Number.isInteger(c.stockQty) || c.stockQty < 0 || c.stockQty > 1_000_000)) {
      throw new InventoryError("Stock must be a whole number, 0 or more.");
    }
    if (c.price !== undefined && (!Number.isFinite(c.price) || c.price <= 0 || c.price > 999_999)) {
      throw new InventoryError("Prices must be more than 0.");
    }
    byId.set(c.variantId, { ...byId.get(c.variantId), ...c });
  }

  return getDb().transaction(async (tx) => {
    const ids = [...byId.keys()];
    const current = await tx
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        stockQty: productVariants.stockQty,
        price: productVariants.price,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(inArray(productVariants.id, ids), eq(products.tenantId, tenantId), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.id))
      .for("update", { of: productVariants });
    if (current.length !== ids.length) throw new InventoryError("Some rows aren't in your shop anymore — reload and try again.");

    let changed = 0;
    const repriced = new Set<string>();
    for (const row of current) {
      const change = byId.get(row.id)!;
      const set: { stockQty?: number; price?: string } = {};
      if (change.stockQty !== undefined && change.stockQty !== (row.stockQty ?? 0)) set.stockQty = change.stockQty;
      if (change.price !== undefined && change.price.toFixed(2) !== Number(row.price).toFixed(2)) {
        set.price = change.price.toFixed(2);
        repriced.add(row.productId);
      }
      if (Object.keys(set).length === 0) continue;
      changed += 1;
      await tx.update(productVariants).set(set).where(eq(productVariants.id, row.id));
      if (set.stockQty !== undefined) {
        await recordStockMovement(tx, {
          tenantId,
          variantId: row.id,
          reason: "adjustment",
          delta: set.stockQty - (row.stockQty ?? 0),
          balanceAfter: set.stockQty,
          actorId: options.actorId ?? null,
          note: options.note,
        });
      }
    }

    for (const productId of repriced) {
      await tx
        .update(products)
        .set({
          basePrice: sql`(select min(${productVariants.price}) from ${productVariants} where ${productVariants.productId} = ${productId} and ${productVariants.active})`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
    }

    return { changed, unchanged: current.length - changed };
  });
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const INVENTORY_CSV_HEADERS = ["product", "product_slug", "variant", "sku", "barcode", "price", "stock"] as const;

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // Leading = + - @ would run as a formula in Excel/Sheets.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function inventoryToCsv(rows: InventoryRow[]): string {
  const lines = [INVENTORY_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.productTitle, r.productSlug, r.variantTitle ?? "", r.sku ?? "", r.barcode ?? "", Number(r.price).toFixed(2), r.stockQty]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface CsvImportPlan {
  changes: Array<StockChange & { line: number; label: string; fromStock: number; fromPrice: string }>;
  skipped: Array<{ line: number; reason: string }>;
}

/**
 * Matches CSV rows to the shop's variants (by SKU first, then product slug +
 * variant name) and works out what would change. Doesn't write anything —
 * pass plan.changes to applyStockChanges after the seller confirms.
 * Only updates existing products; new products are added on the Products page.
 */
export async function planInventoryCsvImport(tenantId: string, csv: string): Promise<CsvImportPlan> {
  const table = parseCsv(csv);
  if (table.length < 2) throw new InventoryError("The file has no rows. Download the template first.");
  if (table.length > 2001) throw new InventoryError("Up to 2,000 rows at a time.");
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  const iSku = col("sku");
  const iSlug = col("product_slug");
  const iVariant = col("variant");
  const iPrice = col("price");
  const iStock = col("stock");
  if (iStock === -1 && iPrice === -1) throw new InventoryError('The file needs a "stock" or "price" column.');
  if (iSku === -1 && iSlug === -1) throw new InventoryError('The file needs a "sku" or "product_slug" column.');

  const inventory = await listInventory(tenantId);
  const bySku = new Map(inventory.filter((r) => r.sku).map((r) => [r.sku!.toLowerCase(), r]));
  const bySlugVariant = new Map(
    inventory.map((r) => [`${r.productSlug.toLowerCase()}\u0000${(r.variantTitle ?? "").toLowerCase()}`, r])
  );

  const plan: CsvImportPlan = { changes: [], skipped: [] };
  const seen = new Set<string>();
  for (let index = 1; index < table.length; index++) {
    const cells = table[index]!;
    const line = index + 1;
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim().replace(/^'/, "") : "");
    const sku = get(iSku);
    const slug = get(iSlug);
    const variant = get(iVariant);
    const match =
      (sku ? bySku.get(sku.toLowerCase()) : undefined) ??
      (slug ? bySlugVariant.get(`${slug.toLowerCase()}\u0000${variant.toLowerCase()}`) : undefined);
    if (!match) {
      plan.skipped.push({ line, reason: sku || slug ? `No product matches ${sku ? `SKU "${sku}"` : `"${slug}${variant ? ` / ${variant}` : ""}"`}.` : "Empty SKU and product_slug." });
      continue;
    }
    if (seen.has(match.variantId)) {
      plan.skipped.push({ line, reason: "Same product listed twice — kept the first row." });
      continue;
    }
    const stockRaw = get(iStock).replace(/,/g, "");
    const priceRaw = get(iPrice).replace(/[₱,\s]/g, "");
    const stock = stockRaw === "" ? undefined : Number(stockRaw);
    const price = priceRaw === "" ? undefined : Number(priceRaw);
    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000)) {
      plan.skipped.push({ line, reason: `Stock "${stockRaw}" isn't a whole number.` });
      continue;
    }
    if (price !== undefined && (!Number.isFinite(price) || price <= 0 || price > 999_999)) {
      plan.skipped.push({ line, reason: `Price "${priceRaw}" isn't valid.` });
      continue;
    }
    seen.add(match.variantId);
    const stockChanges = stock !== undefined && stock !== match.stockQty;
    const priceChanges = price !== undefined && price.toFixed(2) !== Number(match.price).toFixed(2);
    if (!stockChanges && !priceChanges) continue;
    plan.changes.push({
      line,
      variantId: match.variantId,
      label: match.variantTitle ? `${match.productTitle} (${match.variantTitle})` : match.productTitle,
      fromStock: match.stockQty,
      fromPrice: match.price,
      ...(stockChanges ? { stockQty: stock } : {}),
      ...(priceChanges ? { price } : {}),
    });
  }
  return plan;
}
