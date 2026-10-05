import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  marketplaceAccounts,
  marketplaceListings,
  orderItems,
  orderStatusHistory,
  orders,
  productVariants,
  products,
  stockMovements,
  tenants,
  type ChannelAccountStatus,
  type MarketplacePlatform,
} from "../schema/index";
import { getDefaultLocationId } from "./locations";
import { describeStates, legacyStatusOf } from "./order-state";
import { recordStockMovement } from "./stock-ledger";

/**
 * Phase 13 — Shopee / Lazada, data side (API calls live in @gumakart/services).
 *
 * One stock pool: a linked listing mirrors one Guma variant. Paid marketplace orders are
 * imported as completed sales (source_channel 'marketplace', sales_channel = platform) and
 * take stock here — never below zero; a shortfall is reported, not hidden. A marketplace
 * cancellation/return after import puts the stock back once. Then the stock push sends the
 * new counts to every linked listing.
 */

export class MarketplaceSyncError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "TAKEN" | "INVALID") {
    super(message);
    this.name = "MarketplaceError";
  }
}

export interface MarketplaceAccountRow {
  id: string;
  platform: MarketplacePlatform;
  shopExternalId: string;
  name: string;
  status: ChannelAccountStatus;
  syncStock: boolean;
  importOrders: boolean;
  lastStockPushAt: Date | null;
  lastOrderPullAt: Date | null;
  lastError: string | null;
  connectedAt: Date;
  listings: number;
  linked: number;
}

export async function listMarketplaceAccounts(tenantId: string): Promise<MarketplaceAccountRow[]> {
  const rows = await getDb()
    .select({
      a: marketplaceAccounts,
      // Raw aliases: drizzle leaves columns unqualified inside sql`` subqueries.
      listings: sql<number>`(select count(*)::int from marketplace_listings ml where ml.account_id = "marketplace_accounts"."id")`,
      linked: sql<number>`(select count(*)::int from marketplace_listings ml where ml.account_id = "marketplace_accounts"."id" and ml.variant_id is not null)`,
    })
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.tenantId, tenantId), sql`${marketplaceAccounts.status} <> 'disconnected'`))
    .orderBy(asc(marketplaceAccounts.platform));
  return rows.map(({ a, listings, linked }) => ({
    id: a.id,
    platform: a.platform,
    shopExternalId: a.shopExternalId,
    name: a.name,
    status: a.status,
    syncStock: a.syncStock,
    importOrders: a.importOrders,
    lastStockPushAt: a.lastStockPushAt,
    lastOrderPullAt: a.lastOrderPullAt,
    lastError: a.lastError,
    connectedAt: a.connectedAt,
    listings: Number(listings),
    linked: Number(linked),
  }));
}

export async function upsertMarketplaceAccount(input: {
  tenantId: string;
  platform: MarketplacePlatform;
  shopExternalId: string;
  name: string;
  tokensSealed: string | null;
  tokenExpiresAt?: Date | null;
  status?: ChannelAccountStatus;
}): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ tenantId: marketplaceAccounts.tenantId, status: marketplaceAccounts.status })
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.platform, input.platform), eq(marketplaceAccounts.shopExternalId, input.shopExternalId)))
    .limit(1);
  if (existing && existing.tenantId !== input.tenantId && existing.status !== "disconnected") {
    throw new MarketplaceSyncError(`That ${input.platform === "shopee" ? "Shopee" : "Lazada"} shop is connected to another Guma Kart shop.`, "TAKEN");
  }
  const values = {
    tenantId: input.tenantId,
    platform: input.platform,
    shopExternalId: input.shopExternalId,
    name: input.name.slice(0, 160),
    tokensSealed: input.tokensSealed,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    status: input.status ?? ("connected" as ChannelAccountStatus),
    lastError: null,
  };
  const [row] = await db
    .insert(marketplaceAccounts)
    .values({ ...values, ordersCursorAt: new Date() })
    .onConflictDoUpdate({ target: [marketplaceAccounts.platform, marketplaceAccounts.shopExternalId], set: values })
    .returning({ id: marketplaceAccounts.id });
  return row!.id;
}

export async function getMarketplaceAccount(tenantId: string, accountId: string) {
  const [row] = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.id, accountId), eq(marketplaceAccounts.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/** For the cron: every account that syncs. */
export async function listSyncingMarketplaceAccounts(limit = 100) {
  return getDb()
    .select()
    .from(marketplaceAccounts)
    .where(sql`${marketplaceAccounts.status} in ('connected', 'mock')`)
    .orderBy(asc(sql`coalesce(${marketplaceAccounts.lastStockPushAt}, 'epoch'::timestamptz)`))
    .limit(limit);
}

export async function updateMarketplaceAccount(
  tenantId: string,
  accountId: string,
  patch: Partial<{ syncStock: boolean; importOrders: boolean; status: ChannelAccountStatus; lastError: string | null; tokensSealed: string | null; tokenExpiresAt: Date | null; lastStockPushAt: Date; lastOrderPullAt: Date; ordersCursorAt: Date }>
): Promise<boolean> {
  const rows = await getDb()
    .update(marketplaceAccounts)
    .set({ ...patch, ...(patch.lastError !== undefined ? { lastError: patch.lastError?.slice(0, 300) ?? null } : {}) })
    .where(and(eq(marketplaceAccounts.id, accountId), eq(marketplaceAccounts.tenantId, tenantId)))
    .returning({ id: marketplaceAccounts.id });
  return rows.length > 0;
}

export async function disconnectMarketplaceAccount(tenantId: string, accountId: string): Promise<boolean> {
  return updateMarketplaceAccount(tenantId, accountId, { status: "disconnected", tokensSealed: null });
}

// ─── Listings ────────────────────────────────────────────────────────────────

export interface ListingInput {
  externalItemId: string;
  externalModelId: string;
  sku: string | null;
  title: string;
  price: number | null;
  stock: number | null;
}

/**
 * Saves what the marketplace listed and links new listings to Guma variants by SKU
 * (variant SKU, then barcode). Existing links
 * are kept. Returns how many were added and auto-linked.
 */
export async function saveMarketplaceListings(tenantId: string, accountId: string, items: ListingInput[]): Promise<{ saved: number; autoLinked: number }> {
  const db = getDb();
  if (items.length === 0) return { saved: 0, autoLinked: 0 };
  const catalog = await db
    .select({ variantId: productVariants.id, vSku: productVariants.sku, barcode: productVariants.barcode })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.tenantId, tenantId), eq(productVariants.active, true)));
  const bySku = new Map<string, string>();
  for (const c of catalog) {
    if (c.vSku) bySku.set(c.vSku.trim().toLowerCase(), c.variantId);
    if (c.barcode && !bySku.has(c.barcode.trim().toLowerCase())) bySku.set(c.barcode.trim().toLowerCase(), c.variantId);
  }
  let autoLinked = 0;
  for (const item of items.slice(0, 5000)) {
    const match = item.sku ? bySku.get(item.sku.trim().toLowerCase()) ?? null : null;
    const values = {
      tenantId,
      accountId,
      externalItemId: item.externalItemId,
      externalModelId: item.externalModelId ?? "",
      externalSku: item.sku?.slice(0, 120) ?? null,
      title: item.title.slice(0, 300),
      price: item.price != null ? item.price.toFixed(2) : null,
      externalStock: item.stock,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(marketplaceListings)
      .values({ ...values, variantId: match })
      .onConflictDoUpdate({
        target: [marketplaceListings.accountId, marketplaceListings.externalItemId, marketplaceListings.externalModelId],
        set: { ...values, variantId: sql`coalesce(${marketplaceListings.variantId}, ${match})` },
      })
      .returning({ variantId: marketplaceListings.variantId });
    if (match && row?.variantId === match) autoLinked += 1;
  }
  return { saved: items.length, autoLinked };
}

export interface ListingRow {
  id: string;
  externalItemId: string;
  externalModelId: string;
  sku: string | null;
  title: string;
  price: number | null;
  externalStock: number | null;
  variantId: string | null;
  variantLabel: string | null;
  gumaStock: number | null;
  lastPushedQty: number | null;
  lastPushedAt: Date | null;
  pushError: string | null;
}

export async function listMarketplaceListings(tenantId: string, accountId: string): Promise<ListingRow[]> {
  const rows = await getDb()
    .select({
      l: marketplaceListings,
      productTitle: products.title,
      variantTitle: productVariants.title,
      stock: productVariants.stockQty,
      track: products.trackInventory,
      hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
    })
    .from(marketplaceListings)
    .leftJoin(productVariants, eq(productVariants.id, marketplaceListings.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(marketplaceListings.tenantId, tenantId), eq(marketplaceListings.accountId, accountId)))
    .orderBy(asc(marketplaceListings.title))
    .limit(1000);
  return rows.map(({ l, productTitle, variantTitle, stock, track, hasOptions }) => ({
    id: l.id,
    externalItemId: l.externalItemId,
    externalModelId: l.externalModelId,
    sku: l.externalSku,
    title: l.title,
    price: l.price != null ? Number(l.price) : null,
    externalStock: l.externalStock,
    variantId: l.variantId,
    variantLabel: productTitle ? (hasOptions ? `${productTitle} (${variantTitle})` : productTitle) : null,
    gumaStock: l.variantId && track ? (stock ?? 0) : null,
    lastPushedQty: l.lastPushedQty,
    lastPushedAt: l.lastPushedAt,
    pushError: l.pushError,
  }));
}

export async function linkMarketplaceListing(tenantId: string, listingId: string, variantId: string | null): Promise<boolean> {
  const db = getDb();
  if (variantId) {
    const [v] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.id, variantId), eq(products.tenantId, tenantId)))
      .limit(1);
    if (!v) throw new MarketplaceSyncError("That product isn't in this shop.", "INVALID");
  }
  const rows = await db
    .update(marketplaceListings)
    // A new link pushes stock on the next sync.
    .set({ variantId, lastPushedQty: null, pushError: null, updatedAt: new Date() })
    .where(and(eq(marketplaceListings.id, listingId), eq(marketplaceListings.tenantId, tenantId)))
    .returning({ id: marketplaceListings.id });
  return rows.length > 0;
}

/** Demo: mirror the catalog as listings (one per active tracked variant), all linked. */
export async function mirrorCatalogAsListings(tenantId: string, accountId: string): Promise<number> {
  const rows = await getDb()
    .select({
      variantId: productVariants.id,
      productId: products.id,
      title: products.title,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      price: productVariants.price,
      stock: productVariants.stockQty,
      hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.tenantId, tenantId), eq(products.status, "active"), eq(productVariants.active, true)))
    .limit(500);
  const db = getDb();
  for (const r of rows) {
    await db
      .insert(marketplaceListings)
      .values({
        tenantId,
        accountId,
        externalItemId: `demo-${r.productId.slice(0, 8)}`,
        externalModelId: r.hasOptions ? `m-${r.variantId.slice(0, 8)}` : "",
        externalSku: r.sku,
        title: r.hasOptions ? `${r.title} (${r.variantTitle})` : r.title,
        price: r.price,
        externalStock: r.stock,
        variantId: r.variantId,
      })
      .onConflictDoNothing();
  }
  return rows.length;
}

// ─── Stock push ──────────────────────────────────────────────────────────────

export interface StockPushItem {
  listingId: string;
  externalItemId: string;
  externalModelId: string;
  stock: number;
}

/** Linked listings whose marketplace stock differs from Guma's (or was never pushed). */
export async function marketplaceStockPushPlan(tenantId: string, accountId: string, limit = 500): Promise<StockPushItem[]> {
  const rows = await getDb()
    .select({ id: marketplaceListings.id, item: marketplaceListings.externalItemId, model: marketplaceListings.externalModelId, stock: productVariants.stockQty, pushed: marketplaceListings.lastPushedQty })
    .from(marketplaceListings)
    .innerJoin(productVariants, eq(productVariants.id, marketplaceListings.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(marketplaceListings.tenantId, tenantId),
        eq(marketplaceListings.accountId, accountId),
        isNotNull(marketplaceListings.variantId),
        eq(products.trackInventory, true),
        sql`${marketplaceListings.lastPushedQty} is distinct from greatest(${productVariants.stockQty}, 0)`
      )
    )
    .limit(limit);
  return rows.map((r) => ({ listingId: r.id, externalItemId: r.item, externalModelId: r.model, stock: Math.max(r.stock ?? 0, 0) }));
}

export async function recordStockPush(tenantId: string, accountId: string, results: Array<{ listingId: string; stock: number; error?: string | null }>): Promise<void> {
  const db = getDb();
  const now = new Date();
  for (const r of results) {
    await db
      .update(marketplaceListings)
      .set(r.error ? { pushError: r.error.slice(0, 300) } : { lastPushedQty: r.stock, lastPushedAt: now, pushError: null, externalStock: r.stock })
      .where(and(eq(marketplaceListings.id, r.listingId), eq(marketplaceListings.tenantId, tenantId)));
  }
  await db.update(marketplaceAccounts).set({ lastStockPushAt: now }).where(eq(marketplaceAccounts.id, accountId));
}

// ─── Order import ────────────────────────────────────────────────────────────

export interface ImportedOrderInput {
  externalOrderId: string;
  status: "unpaid" | "to_ship" | "shipped" | "completed" | "cancelled" | "returned";
  buyerName: string | null;
  createdAt: Date;
  total: number;
  items: Array<{ externalItemId: string; externalModelId: string; sku: string | null; title: string; quantity: number; unitPrice: number }>;
}

export type ImportResult =
  | { status: "imported"; orderId: string; orderNumber: string; short: Array<{ title: string; short: number }> }
  | { status: "duplicate" | "skipped_unpaid" | "skipped_cancelled" }
  | { status: "cancelled"; orderId: string; restocked: number }
  | { status: "unlinked"; titles: string[] };

const PLATFORM_LABEL: Record<MarketplacePlatform, string> = { shopee: "Shopee", lazada: "Lazada" };

/**
 * Imports one marketplace order. Idempotent per (shop, platform, external order id).
 * Unpaid orders wait; a cancellation/return of an imported order restocks once.
 * Every line must be linked to a Guma variant, otherwise nothing is imported yet and the
 * caller reports which listings to link.
 */
export async function importMarketplaceOrder(
  tenantId: string,
  account: { id: string; platform: MarketplacePlatform },
  input: ImportedOrderInput
): Promise<ImportResult> {
  const db = getDb();
  const label = PLATFORM_LABEL[account.platform];
  const [existing] = await db
    .select({ id: orders.id, orderState: orders.orderState })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.salesChannel, account.platform), eq(orders.externalOrderId, input.externalOrderId)))
    .limit(1);

  if (existing) {
    if ((input.status === "cancelled" || input.status === "returned") && existing.orderState !== "cancelled") {
      return cancelImportedOrder(tenantId, existing.id, `${label} order ${input.status}`);
    }
    return { status: "duplicate" };
  }
  if (input.status === "unpaid") return { status: "skipped_unpaid" };
  if (input.status === "cancelled" || input.status === "returned") return { status: "skipped_cancelled" };

  const listings = await db
    .select({ item: marketplaceListings.externalItemId, model: marketplaceListings.externalModelId, variantId: marketplaceListings.variantId })
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.accountId, account.id), eq(marketplaceListings.tenantId, tenantId)));
  const linkOf = new Map(listings.map((l) => [`${l.item}:${l.model}`, l.variantId]));
  const unlinked = input.items.filter((i) => !linkOf.get(`${i.externalItemId}:${i.externalModelId ?? ""}`));
  if (unlinked.length > 0) return { status: "unlinked", titles: unlinked.map((i) => i.title) };

  return db.transaction(async (tx) => {
    const [tenant] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new MarketplaceSyncError("Shop not found.", "NOT_FOUND");
    const variantIds = [...new Set(input.items.map((i) => linkOf.get(`${i.externalItemId}:${i.externalModelId ?? ""}`)!))];
    const catalog = await tx
      .select({ variantId: productVariants.id, productId: productVariants.productId, title: products.title, variantTitle: productVariants.title, track: products.trackInventory, cost: productVariants.costPrice })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
    const byVariant = new Map(catalog.map((c) => [c.variantId, c]));

    const now = new Date();
    const facts = { orderState: "completed" as const, paymentState: "paid" as const, fulfillmentState: "delivered" as const, accepted: true };
    const [seq] = await tx
      .update(tenants)
      .set({ nextOrderSeq: sql`${tenants.nextOrderSeq} + 1` })
      .where(eq(tenants.id, tenantId))
      .returning({ next: tenants.nextOrderSeq });
    const prefix = tenant.slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ORD";
    const orderNumber = `${prefix}-${String((seq?.next ?? 2) - 1).padStart(4, "0")}`;
    const subtotal = input.items.reduce((s, i) => s + Math.round(i.unitPrice * 100) * i.quantity, 0);
    const locationId = await getDefaultLocationId(tx, tenantId);
    const [order] = await tx
      .insert(orders)
      .values({
        tenantId,
        orderNumber,
        guestName: input.buyerName?.slice(0, 120) || `${label} buyer`,
        guestPhone: null,
        status: legacyStatusOf(facts),
        subtotal: (subtotal / 100).toFixed(2),
        discount: "0.00",
        tax: "0.00",
        deliveryFee: "0.00",
        total: (Math.round(input.total * 100) / 100).toFixed(2),
        paymentStatus: "paid",
        paymentMethod: account.platform,
        deliveryType: "delivery",
        sourceChannel: "marketplace",
        salesChannel: account.platform,
        externalOrderId: input.externalOrderId.slice(0, 80),
        orderState: facts.orderState,
        paymentState: facts.paymentState,
        fulfillmentState: facts.fulfillmentState,
        acceptedAt: now,
        paidAt: input.createdAt,
        completedAt: now,
        createdAt: input.createdAt,
        locationId,
        staffNote: `${label} order ${input.externalOrderId} — shipped and paid through ${label}.`,
      })
      .returning({ id: orders.id });
    await tx.insert(orderItems).values(
      input.items.map((i) => {
        const v = byVariant.get(linkOf.get(`${i.externalItemId}:${i.externalModelId ?? ""}`)!)!;
        return {
          orderId: order!.id,
          productId: v.productId,
          variantId: v.variantId,
          titleSnapshot: i.title.slice(0, 255),
          quantity: i.quantity,
          unitPrice: i.unitPrice.toFixed(2),
          lineTotal: (Math.round(i.unitPrice * 100 * i.quantity) / 100).toFixed(2),
          unitCost: v.cost ?? null,
        };
      })
    );
    await tx.insert(orderStatusHistory).values({
      orderId: order!.id,
      status: legacyStatusOf(facts),
      event: "marketplace_import",
      toState: describeStates(facts),
      note: `Imported from ${label} (${input.externalOrderId})`,
    });
    // Same stock pool: take it here, never below zero, and say when it ran short.
    const short: Array<{ title: string; short: number }> = [];
    const qtyByVariant = new Map<string, { qty: number; title: string }>();
    for (const i of input.items) {
      const vid = linkOf.get(`${i.externalItemId}:${i.externalModelId ?? ""}`)!;
      const prev = qtyByVariant.get(vid);
      qtyByVariant.set(vid, { qty: (prev?.qty ?? 0) + i.quantity, title: i.title });
    }
    for (const [vid, { qty, title }] of qtyByVariant) {
      if (!byVariant.get(vid)?.track) continue;
      const [cur] = await tx.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, vid)).for("update");
      const have = Math.max(cur?.q ?? 0, 0);
      const take = Math.min(have, qty);
      if (take < qty) short.push({ title, short: qty - take });
      if (take > 0) {
        const [after] = await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} - ${take}` })
          .where(eq(productVariants.id, vid))
          .returning({ q: productVariants.stockQty });
        await recordStockMovement(tx, { tenantId, variantId: vid, orderId: order!.id, reason: "sale", delta: -take, balanceAfter: after!.q, locationId, note: `${label} ${input.externalOrderId}` });
      }
    }
    if (short.length) {
      await tx
        .update(orders)
        .set({ staffNote: `${label} order ${input.externalOrderId} — shipped and paid through ${label}. Oversold: ${short.map((s) => `${s.title} by ${s.short}`).join("; ")}. Recount.` })
        .where(eq(orders.id, order!.id));
    }
    return { status: "imported" as const, orderId: order!.id, orderNumber, short };
  });
}

/** Marketplace cancelled/returned an imported order: cancel it here and put the stock back once. */
async function cancelImportedOrder(tenantId: string, orderId: string, reason: string): Promise<ImportResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, orderState: orders.orderState })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .for("update");
    if (!o || o.orderState === "cancelled") return { status: "duplicate" as const };
    const taken = await tx
      .select({ variantId: stockMovements.variantId, delta: stockMovements.delta })
      .from(stockMovements)
      .where(and(eq(stockMovements.orderId, orderId), eq(stockMovements.reason, "sale")));
    let restocked = 0;
    const locationId = await getDefaultLocationId(tx, tenantId);
    for (const t of taken) {
      const qty = -t.delta;
      if (qty <= 0) continue;
      const [after] = await tx
        .update(productVariants)
        .set({ stockQty: sql`${productVariants.stockQty} + ${qty}` })
        .where(eq(productVariants.id, t.variantId))
        .returning({ q: productVariants.stockQty });
      await recordStockMovement(tx, { tenantId, variantId: t.variantId, orderId, reason: "restock_cancel", delta: qty, balanceAfter: after!.q, locationId, note: reason });
      restocked += qty;
    }
    const facts = { orderState: "cancelled" as const, paymentState: "refunded" as const, fulfillmentState: "returned" as const, accepted: true };
    await tx
      .update(orders)
      .set({ orderState: "cancelled", paymentState: "refunded", fulfillmentState: "returned", status: legacyStatusOf(facts), cancelledAt: new Date(), cancelReason: reason.slice(0, 200) })
      .where(eq(orders.id, orderId));
    await tx.insert(orderStatusHistory).values({ orderId, status: legacyStatusOf(facts), event: "marketplace_cancel", toState: describeStates(facts), note: reason });
    return { status: "cancelled" as const, orderId, restocked };
  });
}

/** Orders imported from marketplaces, newest first (for the Channels page). */
export async function listImportedOrders(tenantId: string, limit = 20) {
  return getDb()
    .select({ id: orders.id, orderNumber: orders.orderNumber, salesChannel: orders.salesChannel, externalOrderId: orders.externalOrderId, total: orders.total, orderState: orders.orderState, createdAt: orders.createdAt, staffNote: orders.staffNote })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.sourceChannel, "marketplace")))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

// ─── Sales by channel ────────────────────────────────────────────────────────

export async function salesByChannel(tenantId: string, days = 30, now = new Date()): Promise<Array<{ channel: string; orders: number; sales: number }>> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await getDb()
    .select({
      channel: sql<string>`coalesce(${orders.salesChannel}, case when ${orders.sourceChannel} = 'pos' then 'pos' else 'direct' end)`,
      n: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${orders.total} - coalesce(${orders.refundedAmount}, 0)), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        sql`${orders.createdAt} >= ${since.toISOString()}::timestamptz`,
        sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`,
        isNull(orders.voidedAt)
      )
    )
    .groupBy(sql`1`);
  return rows.map((r) => ({ channel: r.channel, orders: Number(r.n), sales: Math.round(Number(r.total) * 100) / 100 })).sort((a, b) => b.sales - a.sales);
}
