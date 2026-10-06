/**
 * Phase 22: buyer demand capture.
 *  - Back-in-stock alerts: a buyer leaves a phone or email on a sold-out item; when stock comes back
 *    they're told in the order they asked (a cron sends; nothing is sent while stock is 0).
 *  - Wishlists: saved per Guma ID buyer or per anonymous device. Sellers see real save counts.
 *  - Pre-orders: lines that skip stock (see orders.ts); sellers see units waiting to ship.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { productVariants, products, stockAlerts, tenants, wishlistItems } from "../schema";
import { normalizePhMobile } from "./onboarding";

export class DemandError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "INVALID" | "IN_STOCK") {
    super(message);
  }
}

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];

// ─── Back-in-stock alerts ───────────────────────────────────────────────────────────────────────

/** Ask to be told when a sold-out item (or option) is back. Idempotent per contact. */
export async function createStockAlert(input: {
  tenantId: string;
  productId: string;
  variantId?: string | null;
  phone?: string | null;
  email?: string | null;
  buyerAccountId?: string | null;
}): Promise<{ created: boolean }> {
  const phone = input.phone ? normalizePhMobile(input.phone) : null;
  const email = input.email?.trim().toLowerCase() || null;
  if (input.phone && !phone) throw new DemandError("Enter a PH mobile number like 0917 123 4567.", "INVALID");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DemandError("Check the email address.", "INVALID");
  if (!phone && !email) throw new DemandError("Leave a mobile number or email.", "INVALID");

  const db = getDb();
  const variants = await db
    .select({
      id: productVariants.id,
      stockQty: productVariants.stockQty,
      track: products.trackInventory,
      status: products.status,
      hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
    })
    .from(products)
    .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.active, true)))
    .where(and(eq(products.id, input.productId), eq(products.tenantId, input.tenantId)))
    .orderBy(asc(productVariants.position), asc(productVariants.id));
  const first = variants[0];
  if (!first || first.status !== "active") throw new DemandError("This item isn't available.", "NOT_FOUND");
  let variantId: string | null = null;
  let target = first;
  if (first.hasOptions) {
    const match = variants.find((v) => v.id === input.variantId);
    if (!match) throw new DemandError("Pick the option you want first.", "INVALID");
    variantId = match.id;
    target = match;
  }
  if (target.track === false || (target.stockQty ?? 0) > 0) throw new DemandError("It's in stock — you can order it now.", "IN_STOCK");

  const inserted = await db
    .insert(stockAlerts)
    .values({ tenantId: input.tenantId, productId: input.productId, variantId, phone, email, buyerAccountId: input.buyerAccountId ?? null })
    .onConflictDoNothing()
    .returning({ id: stockAlerts.id });
  return { created: inserted.length > 0 };
}

export interface AlertToSend {
  id: string;
  tenantId: string;
  tenantSlug: string;
  shopName: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string | null;
  phone: string | null;
  email: string | null;
  stock: number;
}

/**
 * Waiting alerts whose item is back in stock, oldest first. Per item, at most max(5, 2 × stock) per
 * run — the first buyers to ask hear first, and a restock of 2 doesn't text 200 people at once.
 */
export async function listAlertsToSend(limit = 100): Promise<AlertToSend[]> {
  const data = await rows<{
    id: string;
    tenant_id: string;
    slug: string;
    shop: string;
    title: string;
    pslug: string;
    vtitle: string | null;
    has_options: boolean;
    phone: string | null;
    email: string | null;
    stock: number;
    rn: string;
  }>(sql`
    with live as (
      select a.*, coalesce(a.variant_id, (
               select v.id from product_variants v where v.product_id = a.product_id and v.active
               order by v.position, v.id limit 1)) as vid
      from stock_alerts a where a.status = 'waiting'
    )
    select * from (
      select l.id, l.tenant_id, t.slug, t.name as shop, p.title, p.slug as pslug, v.title as vtitle,
             (p.options_json is not null and jsonb_array_length(p.options_json) > 0) as has_options,
             l.phone, l.email, coalesce(v.stock_qty, 0) as stock,
             row_number() over (partition by l.vid order by l.created_at) as rn
      from live l
      join products p on p.id = l.product_id and p.status = 'active'
      join tenants t on t.id = l.tenant_id and t.status = 'active'
      join product_variants v on v.id = l.vid and v.active
      where p.track_inventory = false or coalesce(v.stock_qty, 0) > 0
    ) x
    where x.rn <= greatest(5, x.stock * 2)
    order by x.rn, x.id
    limit ${limit}`);
  return data.map((d) => ({
    id: d.id,
    tenantId: d.tenant_id,
    tenantSlug: d.slug,
    shopName: d.shop,
    productTitle: d.title,
    productSlug: d.pslug,
    variantTitle: d.has_options ? d.vtitle : null,
    phone: d.phone,
    email: d.email,
    stock: Number(d.stock),
  }));
}

export async function markAlertNotified(id: string): Promise<void> {
  await getDb()
    .update(stockAlerts)
    .set({ status: "notified", notifiedAt: new Date() })
    .where(and(eq(stockAlerts.id, id), eq(stockAlerts.status, "waiting")));
}

/** Waiting buyers per variant (products without options count under their only variant). */
export async function getWaitingCountsByVariant(tenantId: string): Promise<Map<string, number>> {
  const data = await rows<{ vid: string; n: string }>(sql`
    select coalesce(a.variant_id, (select v.id from product_variants v where v.product_id = a.product_id and v.active
                                   order by v.position, v.id limit 1)) as vid, count(*) as n
    from stock_alerts a where a.tenant_id = ${tenantId} and a.status = 'waiting' group by 1`);
  return new Map(data.filter((d) => d.vid).map((d) => [d.vid, Number(d.n)]));
}

/** Contacts waiting for one item, oldest first — so a seller without SMS can message them by hand. */
export async function listWaitingContacts(tenantId: string, productId: string): Promise<Array<{ id: string; variantTitle: string | null; phone: string | null; email: string | null; createdAt: string }>> {
  const data = await getDb()
    .select({ id: stockAlerts.id, variantTitle: productVariants.title, variantId: stockAlerts.variantId, phone: stockAlerts.phone, email: stockAlerts.email, createdAt: stockAlerts.createdAt })
    .from(stockAlerts)
    .leftJoin(productVariants, eq(productVariants.id, stockAlerts.variantId))
    .where(and(eq(stockAlerts.tenantId, tenantId), eq(stockAlerts.productId, productId), eq(stockAlerts.status, "waiting")))
    .orderBy(asc(stockAlerts.createdAt))
    .limit(500);
  return data.map((d) => ({ id: d.id, variantTitle: d.variantId ? d.variantTitle : null, phone: d.phone, email: d.email, createdAt: d.createdAt.toISOString() }));
}

// ─── Seller summary ─────────────────────────────────────────────────────────────────────────────

export interface DemandSummary {
  waiting: Array<{ productId: string; title: string; waiting: number; inStock: boolean }>;
  mostSaved: Array<{ productId: string; title: string; saves: number }>;
  preorders: Array<{ productId: string; title: string; units: number; orders: number; shipDate: string | null }>;
  totals: { waiting: number; saves: number; preorderUnits: number };
}

export async function getDemandSummary(tenantId: string): Promise<DemandSummary> {
  const [waiting, saved, pre] = await Promise.all([
    rows<{ product_id: string; title: string; n: string; in_stock: boolean }>(sql`
      select a.product_id, p.title, count(*) as n,
             (p.track_inventory = false or exists (select 1 from product_variants v where v.product_id = p.id and v.active and coalesce(v.stock_qty,0) > 0)) as in_stock
      from stock_alerts a join products p on p.id = a.product_id
      where a.tenant_id = ${tenantId} and a.status = 'waiting'
      group by a.product_id, p.title, p.track_inventory, p.id order by n desc limit 20`),
    rows<{ product_id: string; title: string; n: string }>(sql`
      select w.product_id, p.title, count(*) as n from wishlist_items w join products p on p.id = w.product_id
      where w.tenant_id = ${tenantId} and p.status = 'active'
      group by w.product_id, p.title order by n desc limit 10`),
    rows<{ product_id: string; title: string; units: string; orders: string; ship: string | null }>(sql`
      select i.product_id, p.title, sum(i.quantity - i.returned_qty) as units, count(distinct o.id) as orders, max(i.preorder_ship_date)::text as ship
      from order_items i join orders o on o.id = i.order_id join products p on p.id = i.product_id
      where o.tenant_id = ${tenantId} and i.preorder_ship_date is not null
        and coalesce(o.order_state::text, 'open') = 'open' and o.voided_at is null
        and coalesce(o.fulfillment_state::text, 'unfulfilled') in ('unfulfilled', 'ready')
      group by i.product_id, p.title order by units desc limit 20`),
  ]);
  return {
    waiting: waiting.map((w) => ({ productId: w.product_id, title: w.title, waiting: Number(w.n), inStock: Boolean(w.in_stock) })),
    mostSaved: saved.map((s) => ({ productId: s.product_id, title: s.title, saves: Number(s.n) })),
    preorders: pre.map((p) => ({ productId: p.product_id, title: p.title, units: Number(p.units), orders: Number(p.orders), shipDate: p.ship })),
    totals: {
      waiting: waiting.reduce((a, w) => a + Number(w.n), 0),
      saves: saved.reduce((a, s) => a + Number(s.n), 0),
      preorderUnits: pre.reduce((a, p) => a + Number(p.units), 0),
    },
  };
}

// ─── Wishlists ──────────────────────────────────────────────────────────────────────────────────

type Owner = { buyerAccountId: string } | { deviceId: string };

function ownerWhere(owner: Owner) {
  return "buyerAccountId" in owner
    ? eq(wishlistItems.buyerAccountId, owner.buyerAccountId)
    : and(eq(wishlistItems.deviceId, owner.deviceId), isNull(wishlistItems.buyerAccountId));
}

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9-]{16,40}$/.test(id);
}

/** Save or unsave one product for a buyer (Guma ID) or a guest device. */
export async function setWishlisted(tenantId: string, productId: string, owner: Owner, saved: boolean): Promise<void> {
  const db = getDb();
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (!p) throw new DemandError("Product not found.", "NOT_FOUND");
  if (saved) {
    await db
      .insert(wishlistItems)
      .values({
        tenantId,
        productId,
        buyerAccountId: "buyerAccountId" in owner ? owner.buyerAccountId : null,
        deviceId: "deviceId" in owner ? owner.deviceId : null,
      })
      .onConflictDoNothing();
  } else {
    await db.delete(wishlistItems).where(and(eq(wishlistItems.productId, productId), ownerWhere(owner)));
  }
}

/** Saved product ids at one shop. */
export async function listWishlist(tenantId: string, owner: Owner): Promise<string[]> {
  const data = await getDb()
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(and(eq(wishlistItems.tenantId, tenantId), ownerWhere(owner)))
    .orderBy(asc(wishlistItems.createdAt));
  return data.map((d) => d.productId);
}

/** After a guest signs in to Guma ID, move this device's saves onto their account. */
export async function claimDeviceWishlist(deviceId: string, buyerAccountId: string): Promise<number> {
  const db = getDb();
  const device = await db
    .select({ tenantId: wishlistItems.tenantId, productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(and(eq(wishlistItems.deviceId, deviceId), isNull(wishlistItems.buyerAccountId)));
  if (!device.length) return 0;
  await db
    .insert(wishlistItems)
    .values(device.map((d) => ({ ...d, buyerAccountId, deviceId: null })))
    .onConflictDoNothing();
  await db.delete(wishlistItems).where(and(eq(wishlistItems.deviceId, deviceId), isNull(wishlistItems.buyerAccountId)));
  return device.length;
}

/** For Guma ID data export. */
export async function exportBuyerDemand(buyerAccountId: string): Promise<{ saved: Array<{ shop: string; product: string }>; alerts: Array<{ shop: string; product: string; status: string }> }> {
  const db = getDb();
  const saved = await db
    .select({ shop: tenants.name, product: products.title })
    .from(wishlistItems)
    .innerJoin(products, eq(products.id, wishlistItems.productId))
    .innerJoin(tenants, eq(tenants.id, wishlistItems.tenantId))
    .where(eq(wishlistItems.buyerAccountId, buyerAccountId));
  const alerts = await db
    .select({ shop: tenants.name, product: products.title, status: stockAlerts.status })
    .from(stockAlerts)
    .innerJoin(products, eq(products.id, stockAlerts.productId))
    .innerJoin(tenants, eq(tenants.id, stockAlerts.tenantId))
    .where(eq(stockAlerts.buyerAccountId, buyerAccountId));
  return { saved, alerts };
}

/** Remove a buyer's stock alerts (Guma ID account deletion). */
export async function deleteBuyerAlerts(buyerAccountId: string): Promise<void> {
  await getDb().delete(stockAlerts).where(inArray(stockAlerts.buyerAccountId, [buyerAccountId]));
}
