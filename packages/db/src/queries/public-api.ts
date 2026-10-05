import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "../client";
import {
  customers,
  orderItems,
  orders,
  productImages,
  productVariants,
  products,
} from "../schema/index";
import { apiMoney, encodeCursor, type ApiCursor } from "../types/developer";
import { applyStockChanges, InventoryError } from "./inventory";

/**
 * Phase 15 — read models for the public REST API (/api/v1) and webhook payloads. Every query
 * is scoped by tenant; ids from another shop simply aren't found. Field names are snake_case
 * and stable: add fields, never rename them.
 */

export interface ApiPage<T> {
  data: T[];
  next_cursor: string | null;
}

export interface ApiAddress {
  line1: string | null;
  line2: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  notes: string | null;
}

export interface ApiOrderItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  returned_quantity: number;
  unit_price: string;
  line_total: string;
}

export interface ApiOrder {
  id: string;
  number: string;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  voided_at: string | null;
  order_state: string;
  payment_state: string;
  fulfillment_state: string;
  channel: string | null;
  payment_method: string | null;
  delivery_type: string | null;
  buyer: { name: string | null; phone: string | null; email: string | null; customer_id: string | null };
  shipping_address: ApiAddress | null;
  currency: "PHP";
  subtotal: string;
  discount: string;
  delivery_fee: string;
  tax: string;
  total: string;
  refunded: string;
  coupon_code: string | null;
  note: string | null;
  tags: string[];
  invoice_number: string | null;
  external_order_id: string | null;
  items: ApiOrderItem[];
}

export interface ApiVariant {
  id: string;
  product_id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compare_at_price: string | null;
  stock: number;
  options: Record<string, string>;
  active: boolean;
  image_url: string | null;
}

export interface ApiProduct {
  id: string;
  title: string;
  slug: string;
  status: string;
  description_html: string | null;
  price: string;
  compare_at_price: string | null;
  track_inventory: boolean;
  options: Array<{ name: string; values: string[] }>;
  images: string[];
  created_at: string;
  updated_at: string;
  variants: ApiVariant[];
}

export interface ApiCustomer {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  sms_marketing: boolean;
  orders_count: number;
  total_spent: string;
  first_order_at: string | null;
  last_order_at: string | null;
  created_at: string;
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function apiAddress(json: unknown): ApiAddress | null {
  if (!json || typeof json !== "object") return null;
  const a = json as Record<string, unknown>;
  const out: ApiAddress = {
    line1: str(a.line1) ?? str(a.full) ?? str(a.text),
    line2: str(a.line2),
    barangay: str(a.barangay),
    city: str(a.city),
    province: str(a.province),
    postal_code: str(a.postalCode),
    notes: str(a.notes),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

/** Keyset condition for "created_at desc, id desc" pages. */
function before(createdAt: AnyPgColumn, id: AnyPgColumn, cursor: ApiCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  // Postgres keeps microseconds, JS Dates keep milliseconds: compare and sort at ms precision.
  return sql`(date_trunc('milliseconds', ${createdAt}), ${id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`;
}

/** Newest first, matching before(). */
function newestFirst(createdAt: AnyPgColumn, id: AnyPgColumn): SQL[] {
  return [sql`date_trunc('milliseconds', ${createdAt}) desc`, desc(id)];
}

function page<T, R extends { createdAt: Date; id: string }>(rows: R[], limit: number, map: (r: R) => T): ApiPage<T> {
  const more = rows.length > limit;
  const slice = more ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return {
    data: slice.map(map),
    next_cursor: more && last ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id }) : null,
  };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

type OrderRow = typeof orders.$inferSelect;

async function attachItems(rows: OrderRow[]): Promise<ApiOrder[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const lines = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      title: orderItems.titleSnapshot,
      variantTitle: orderItems.variantSnapshot,
      sku: productVariants.sku,
      quantity: orderItems.quantity,
      returnedQty: orderItems.returnedQty,
      unitPrice: orderItems.unitPrice,
      lineTotal: orderItems.lineTotal,
    })
    .from(orderItems)
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
    .orderBy(asc(orderItems.id));
  const byOrder = new Map<string, ApiOrderItem[]>();
  for (const l of lines) {
    const list = byOrder.get(l.orderId) ?? [];
    list.push({
      id: l.id,
      product_id: l.productId,
      variant_id: l.variantId,
      title: l.title,
      variant_title: l.variantTitle && l.variantTitle !== "Default" && l.variantTitle !== l.title ? l.variantTitle : null,
      sku: l.sku,
      quantity: l.quantity,
      returned_quantity: l.returnedQty,
      unit_price: apiMoney(l.unitPrice),
      line_total: apiMoney(l.lineTotal),
    });
    byOrder.set(l.orderId, list);
  }
  return rows.map((o) => ({
    id: o.id,
    number: o.orderNumber,
    created_at: o.createdAt.toISOString(),
    paid_at: iso(o.paidAt),
    completed_at: iso(o.completedAt),
    cancelled_at: iso(o.cancelledAt),
    voided_at: iso(o.voidedAt),
    order_state: o.orderState ?? "open",
    payment_state: o.paymentState ?? "unpaid",
    fulfillment_state: o.fulfillmentState ?? "unfulfilled",
    channel: o.salesChannel,
    payment_method: o.paymentMethod,
    delivery_type: o.deliveryType,
    buyer: { name: o.guestName, phone: o.guestPhone, email: o.guestEmail, customer_id: o.customerRecordId },
    shipping_address: o.deliveryType === "pickup" ? null : apiAddress(o.deliveryAddressJson),
    currency: "PHP",
    subtotal: apiMoney(o.subtotal),
    discount: apiMoney(o.discount),
    delivery_fee: apiMoney(o.deliveryFee),
    tax: apiMoney(o.tax),
    total: apiMoney(o.total),
    refunded: apiMoney(o.refundedAmount),
    coupon_code: o.couponCode,
    note: o.notes,
    tags: Array.isArray(o.tagsJson) ? o.tagsJson : [],
    invoice_number: o.invoiceNumber,
    external_order_id: o.externalOrderId,
    items: byOrder.get(o.id) ?? [],
  }));
}

export interface ApiOrderFilters {
  limit: number;
  cursor: ApiCursor | null;
  orderState?: string | null;
  paymentState?: string | null;
  fulfillmentState?: string | null;
  channel?: string | null;
  createdAfter?: Date | null;
  createdBefore?: Date | null;
}

export async function apiListOrders(tenantId: string, f: ApiOrderFilters): Promise<ApiPage<ApiOrder>> {
  const conds: SQL[] = [eq(orders.tenantId, tenantId)];
  if (f.orderState) conds.push(sql`${orders.orderState}::text = ${f.orderState}`);
  if (f.paymentState) conds.push(sql`${orders.paymentState}::text = ${f.paymentState}`);
  if (f.fulfillmentState) conds.push(sql`${orders.fulfillmentState}::text = ${f.fulfillmentState}`);
  if (f.channel) conds.push(eq(orders.salesChannel, f.channel));
  if (f.createdAfter) conds.push(gt(orders.createdAt, f.createdAfter));
  if (f.createdBefore) conds.push(lt(orders.createdAt, f.createdBefore));
  const k = before(orders.createdAt, orders.id, f.cursor);
  if (k) conds.push(k);
  const rows = await getDb()
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(...newestFirst(orders.createdAt, orders.id))
    .limit(f.limit + 1);
  const more = rows.length > f.limit;
  const full = await attachItems(more ? rows.slice(0, f.limit) : rows);
  const last = full[full.length - 1];
  return { data: full, next_cursor: more && last ? encodeCursor({ t: last.created_at, i: last.id }) : null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** By id, or by the shop's order number (e.g. "0042" or "GK-0042"). */
export async function apiGetOrder(tenantId: string, idOrNumber: string): Promise<ApiOrder | null> {
  const key = idOrNumber.trim();
  if (!key || key.length > 64) return null;
  const where = UUID.test(key)
    ? and(eq(orders.tenantId, tenantId), eq(orders.id, key))
    : and(eq(orders.tenantId, tenantId), eq(orders.orderNumber, key));
  const rows = await getDb().select().from(orders).where(where).limit(1);
  const [one] = await attachItems(rows);
  return one ?? null;
}

export async function apiOrdersByIds(tenantId: string, ids: string[]): Promise<Map<string, ApiOrder>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, [...new Set(ids)])));
  return new Map((await attachItems(rows)).map((o) => [o.id, o]));
}

// ─── Products and stock ──────────────────────────────────────────────────────

type VariantRow = typeof productVariants.$inferSelect;

function apiVariant(v: VariantRow): ApiVariant {
  return {
    id: v.id,
    product_id: v.productId,
    title: v.title,
    sku: v.sku,
    barcode: v.barcode,
    price: apiMoney(v.price),
    compare_at_price: v.compareAtPrice != null ? apiMoney(v.compareAtPrice) : null,
    stock: v.stockQty ?? 0,
    options: v.optionsJson ?? {},
    active: v.active,
    image_url: v.imageUrl,
  };
}

async function attachVariants(rows: Array<typeof products.$inferSelect>): Promise<ApiProduct[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const [variants, images] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position), asc(productVariants.id)),
    db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder), asc(productImages.id)),
  ]);
  const vBy = new Map<string, ApiVariant[]>();
  for (const v of variants) vBy.set(v.productId, [...(vBy.get(v.productId) ?? []), apiVariant(v)]);
  const iBy = new Map<string, string[]>();
  for (const i of images) iBy.set(i.productId, [...(iBy.get(i.productId) ?? []), i.url]);
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    description_html: p.descriptionHtml,
    price: apiMoney(p.basePrice),
    compare_at_price: p.compareAtPrice != null ? apiMoney(p.compareAtPrice) : null,
    track_inventory: p.trackInventory ?? true,
    options: p.optionsJson ?? [],
    images: iBy.get(p.id) ?? [],
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    variants: vBy.get(p.id) ?? [],
  }));
}

export async function apiListProducts(
  tenantId: string,
  f: { limit: number; cursor: ApiCursor | null; status?: string | null }
): Promise<ApiPage<ApiProduct>> {
  const conds: SQL[] = [eq(products.tenantId, tenantId)];
  if (f.status) conds.push(sql`${products.status}::text = ${f.status}`);
  const k = before(products.createdAt, products.id, f.cursor);
  if (k) conds.push(k);
  const rows = await getDb()
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(...newestFirst(products.createdAt, products.id))
    .limit(f.limit + 1);
  const more = rows.length > f.limit;
  const full = await attachVariants(more ? rows.slice(0, f.limit) : rows);
  const last = full[full.length - 1];
  return { data: full, next_cursor: more && last ? encodeCursor({ t: last.created_at, i: last.id }) : null };
}

export async function apiGetProduct(tenantId: string, id: string): Promise<ApiProduct | null> {
  if (!UUID.test(id)) return null;
  const rows = await getDb().select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).limit(1);
  const [one] = await attachVariants(rows);
  return one ?? null;
}

export interface ApiStockRow extends ApiVariant {
  product_title: string;
}

/** Variant-level stock, oldest variant first (stable order; cursor on the variant id). */
export async function apiListInventory(
  tenantId: string,
  f: { limit: number; after?: string | null; sku?: string | null; barcode?: string | null }
): Promise<{ data: ApiStockRow[]; next_cursor: string | null }> {
  const conds: SQL[] = [eq(products.tenantId, tenantId)];
  if (f.sku) conds.push(eq(productVariants.sku, f.sku));
  if (f.barcode) conds.push(eq(productVariants.barcode, f.barcode));
  if (f.after && UUID.test(f.after)) conds.push(gt(productVariants.id, f.after));
  const rows = await getDb()
    .select({ v: productVariants, productTitle: products.title })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(...conds))
    .orderBy(asc(productVariants.id))
    .limit(f.limit + 1);
  const more = rows.length > f.limit;
  const slice = more ? rows.slice(0, f.limit) : rows;
  return {
    data: slice.map((r) => ({ ...apiVariant(r.v), product_title: r.productTitle })),
    next_cursor: more ? slice[slice.length - 1]!.v.id : null,
  };
}

export async function apiVariantsByIds(tenantId: string, ids: string[]): Promise<Map<string, ApiStockRow>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ v: productVariants, productTitle: products.title })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.tenantId, tenantId), inArray(productVariants.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.v.id, { ...apiVariant(r.v), product_title: r.productTitle }]));
}

export class ApiInputError extends Error {
  constructor(message: string, readonly details?: Array<{ index: number; error: string }>) {
    super(message);
  }
}

/**
 * Sets counted stock. Each item names a variant by `variant_id` or `sku`. Any unknown or
 * ambiguous item rejects the whole request (nothing is written).
 */
export async function apiSetStock(
  tenantId: string,
  items: Array<{ variant_id?: string; sku?: string; stock: number }>,
  actor: { note: string }
): Promise<{ changed: number; unchanged: number; variants: ApiStockRow[] }> {
  if (items.length === 0) throw new ApiInputError("Send at least one item.");
  if (items.length > 500) throw new ApiInputError("Up to 500 items per request.");
  const db = getDb();
  const skus = [...new Set(items.map((i) => i.sku?.trim()).filter((s): s is string => Boolean(s)))];
  const bySku = new Map<string, string[]>();
  if (skus.length) {
    const rows = await db
      .select({ id: productVariants.id, sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.tenantId, tenantId), inArray(productVariants.sku, skus)));
    for (const r of rows) if (r.sku) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r.id]);
  }
  const errors: Array<{ index: number; error: string }> = [];
  const changes = items.map((item, index) => {
    let variantId = item.variant_id?.trim() ?? "";
    if (!variantId && item.sku) {
      const found = bySku.get(item.sku.trim()) ?? [];
      if (found.length === 0) errors.push({ index, error: `No variant has SKU ${item.sku}.` });
      else if (found.length > 1) errors.push({ index, error: `SKU ${item.sku} is used by ${found.length} variants — use variant_id.` });
      variantId = found[0] ?? "";
    } else if (variantId && !UUID.test(variantId)) {
      errors.push({ index, error: "variant_id is not a valid id." });
    } else if (!variantId) {
      errors.push({ index, error: "Give variant_id or sku." });
    }
    if (!Number.isInteger(item.stock) || item.stock < 0 || item.stock > 1_000_000) {
      errors.push({ index, error: "stock must be a whole number from 0 to 1,000,000." });
    }
    return { variantId, stockQty: item.stock };
  });
  if (errors.length) throw new ApiInputError("Some items couldn't be applied. Nothing was changed.", errors);
  try {
    const result = await applyStockChanges(tenantId, changes, { note: actor.note, actorId: null });
    const fresh = await apiVariantsByIds(tenantId, changes.map((c) => c.variantId));
    return { ...result, variants: changes.map((c) => fresh.get(c.variantId)).filter((v): v is ApiStockRow => Boolean(v)) };
  } catch (error) {
    if (error instanceof InventoryError) throw new ApiInputError(error.message);
    throw error;
  }
}

// ─── Customers ───────────────────────────────────────────────────────────────

const customerStats = {
  ordersCount: sql<number>`(select count(*)::int from "orders" o where o."customer_record_id" = "customers"."id" and o."voided_at" is null and coalesce(o."order_state"::text, 'open') <> 'cancelled')`,
  totalSpent: sql<string>`(select coalesce(sum(o."total" - o."refunded_amount"), 0)::text from "orders" o where o."customer_record_id" = "customers"."id" and o."voided_at" is null and coalesce(o."order_state"::text, 'open') <> 'cancelled')`,
};

function apiCustomer(r: typeof customers.$inferSelect & { ordersCount: number; totalSpent: string }): ApiCustomer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    sms_marketing: r.smsMarketingOptIn,
    orders_count: r.ordersCount ?? 0,
    total_spent: apiMoney(r.totalSpent),
    first_order_at: iso(r.firstOrderAt),
    last_order_at: iso(r.lastOrderAt),
    created_at: r.createdAt.toISOString(),
  };
}

export async function apiListCustomers(
  tenantId: string,
  f: { limit: number; cursor: ApiCursor | null; phone?: string | null }
): Promise<ApiPage<ApiCustomer>> {
  const conds: SQL[] = [eq(customers.tenantId, tenantId)];
  if (f.phone) {
    const last10 = f.phone.replace(/\D/g, "").slice(-10);
    if (last10.length === 10) conds.push(sql`right(regexp_replace(${customers.phone}, '\\D', '', 'g'), 10) = ${last10}`);
    else conds.push(sql`false`);
  }
  const k = before(customers.createdAt, customers.id, f.cursor);
  if (k) conds.push(k);
  const rows = await getDb()
    .select({ c: customers, ...customerStats })
    .from(customers)
    .where(and(...conds))
    .orderBy(...newestFirst(customers.createdAt, customers.id))
    .limit(f.limit + 1);
  return page(
    rows.map((r) => ({ ...r.c, ordersCount: r.ordersCount, totalSpent: r.totalSpent })),
    f.limit,
    apiCustomer
  );
}

export async function apiCustomersByIds(tenantId: string, ids: string[]): Promise<Map<string, ApiCustomer>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ c: customers, ...customerStats })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.c.id, apiCustomer({ ...r.c, ordersCount: r.ordersCount, totalSpent: r.totalSpent })]));
}

export async function apiGetCustomer(tenantId: string, id: string): Promise<ApiCustomer | null> {
  if (!UUID.test(id)) return null;
  return (await apiCustomersByIds(tenantId, [id])).get(id) ?? null;
}
