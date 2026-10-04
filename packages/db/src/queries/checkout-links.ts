import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  checkoutLinkItems,
  checkoutLinks,
  orders,
  productImages,
  productVariants,
  products,
  tenants,
} from "../schema/index";
import {
  checkoutFromLegacySettings,
  isPaymentMethodEnabled,
  normalizeCheckoutJson,
} from "../types/tenant-checkout";
import {
  isPickupEnabled,
  normalizeShippingJson,
  shippingFromLegacyDelivery,
} from "../types/tenant-shipping";

/**
 * Guma Checkout Links (Phase 3, plan §5).
 *
 * A link says *what* (products + quantity) and *how* (delivery/pickup, payment
 * methods). Prices are never stored on the link: checkout always reads the
 * variant's current price, the same as the storefront.
 */

export const CHECKOUT_LINK_SHARE_CHANNELS = [
  "facebook",
  "instagram",
  "tiktok",
  "messenger",
  "other",
] as const;
export type CheckoutLinkShareChannel = (typeof CHECKOUT_LINK_SHARE_CHANNELS)[number];

export const CHECKOUT_LINK_DELIVERY_MODES = ["both", "delivery", "pickup"] as const;
export type CheckoutLinkDeliveryMode = (typeof CHECKOUT_LINK_DELIVERY_MODES)[number];

/** Payment methods a link can offer, in display order. */
export const CHECKOUT_LINK_PAYMENT_METHODS = ["gcash", "paymaya", "cod", "bank", "qrph", "card"] as const;
export type CheckoutLinkPaymentMethod = (typeof CHECKOUT_LINK_PAYMENT_METHODS)[number];

export const CHECKOUT_LINK_PAYMENT_LABELS: Record<CheckoutLinkPaymentMethod, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  cod: "Cash on delivery",
  bank: "Bank transfer",
  qrph: "QR Ph",
  card: "Card",
};

export const CHECKOUT_LINK_MAX_ITEMS = 10;

/** No 0/o/1/l/i, so a code read out loud or typed from a photo still works. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 7;
const CODE_PATTERN = /^[a-hj-km-np-z2-9]{7}$/;

export function generateCheckoutLinkCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

export function isCheckoutLinkCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

export class CheckoutLinkError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_PRODUCTS" | "NO_PAYMENT_METHOD" | "NO_DELIVERY_OPTION" | "NOT_FOUND"
  ) {
    super(message);
    this.name = "CheckoutLinkError";
  }
}

// ─── What the shop can offer ─────────────────────────────────────────────────

export interface CheckoutLinkShopOptions {
  paymentMethods: Array<{
    id: CheckoutLinkPaymentMethod;
    label: string;
    /** e.g. GCash is on but no GCash number is saved yet (manual payments). */
    needsSetup: boolean;
  }>;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
}

type TenantPaymentSettings = {
  payments?: {
    mode?: "manual_ewallet" | "paymongo" | "both";
    receiving?: { gcashNumber?: string; mayaNumber?: string; bankAccountNumber?: string };
  };
};

export function resolveCheckoutLinkShopOptions(tenant: {
  settingsJson: unknown;
  checkoutPublishedJson: unknown;
  shippingPublishedJson: unknown;
}): CheckoutLinkShopOptions {
  const settings = (tenant.settingsJson ?? {}) as Parameters<typeof checkoutFromLegacySettings>[0] &
    Parameters<typeof shippingFromLegacyDelivery>[0] &
    TenantPaymentSettings & { delivery?: Parameters<typeof shippingFromLegacyDelivery>[0] };
  const checkout = tenant.checkoutPublishedJson
    ? normalizeCheckoutJson(tenant.checkoutPublishedJson)
    : checkoutFromLegacySettings(settings);
  const shipping = tenant.shippingPublishedJson
    ? normalizeShippingJson(tenant.shippingPublishedJson)
    : shippingFromLegacyDelivery(settings.delivery);

  const mode = settings.payments?.mode ?? "manual_ewallet";
  const receiving = settings.payments?.receiving ?? {};
  const manualOn = mode !== "paymongo";
  const pm = checkout.paymentAdapters?.paymongo;

  const needsSetup: Record<CheckoutLinkPaymentMethod, boolean> = {
    gcash: manualOn && pm?.gcash !== true && !receiving.gcashNumber?.trim(),
    paymaya: manualOn && pm?.paymaya !== true && !receiving.mayaNumber?.trim(),
    bank: !receiving.bankAccountNumber?.trim(),
    cod: false,
    qrph: false,
    card: false,
  };

  const paymentMethods = CHECKOUT_LINK_PAYMENT_METHODS.filter((m) => {
    if (!isPaymentMethodEnabled(checkout, m)) return false;
    // Online-only methods need PayMongo mode (on hold until registration is done).
    if ((m === "qrph" || m === "card") && mode === "manual_ewallet") return false;
    return true;
  }).map((id) => ({ id, label: CHECKOUT_LINK_PAYMENT_LABELS[id], needsSetup: needsSetup[id] }));

  // Delivery is always offered, same as the storefront checkout (fee from the
  // live quote or the shop's rates); pickup only when the shop turned it on.
  return { paymentMethods, deliveryEnabled: true, pickupEnabled: isPickupEnabled(shipping) };
}

export async function getCheckoutLinkShopOptions(tenantId: string): Promise<CheckoutLinkShopOptions> {
  const db = getDb();
  const [tenant] = await db
    .select({
      settingsJson: tenants.settingsJson,
      checkoutPublishedJson: tenants.checkoutPublishedJson,
      shippingPublishedJson: tenants.shippingPublishedJson,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new CheckoutLinkError("Shop not found.", "NOT_FOUND");
  return resolveCheckoutLinkShopOptions(tenant);
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type CheckoutLinkStatus = "live" | "off" | "expired" | "sold_out";

export function checkoutLinkStatus(
  link: { active: boolean; expiresAt: Date | null; maxOrders: number | null; orderCount: number },
  now = new Date()
): CheckoutLinkStatus {
  if (!link.active) return "off";
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return "expired";
  if (link.maxOrders != null && link.orderCount >= link.maxOrders) return "sold_out";
  return "live";
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateCheckoutLinkInput {
  title?: string;
  items: Array<{ productId: string; quantity: number }>;
  shareChannel?: CheckoutLinkShareChannel | null;
  allowQuantityEdit?: boolean;
  deliveryMode?: CheckoutLinkDeliveryMode;
  /** Subset of the shop's methods; empty/undefined = all of them. */
  paymentMethods?: CheckoutLinkPaymentMethod[] | null;
  expiresAt?: Date | null;
  maxOrders?: number | null;
}

export async function createCheckoutLink(
  tenantId: string,
  userId: string | null,
  input: CreateCheckoutLinkInput
): Promise<CheckoutLinkSummary> {
  const db = getDb();

  // Merge duplicate products; keep the order the seller picked them in.
  const merged = new Map<string, number>();
  for (const item of input.items) {
    merged.set(item.productId, Math.min(99, (merged.get(item.productId) ?? 0) + item.quantity));
  }
  const productIds = [...merged.keys()];
  if (productIds.length === 0 || productIds.length > CHECKOUT_LINK_MAX_ITEMS) {
    throw new CheckoutLinkError(
      `Pick between 1 and ${CHECKOUT_LINK_MAX_ITEMS} products.`,
      "INVALID_PRODUCTS"
    );
  }

  // Products must belong to this shop and be active. Use the same variant
  // checkout charges today (lowest id).
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      status: products.status,
      variantId: productVariants.id,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .orderBy(asc(productVariants.id));

  const found = new Map<string, { title: string; status: string; variantId: string | null }>();
  for (const row of rows) {
    if (!found.has(row.id)) found.set(row.id, { title: row.title, status: row.status, variantId: row.variantId });
  }
  const missing = productIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new CheckoutLinkError("Some products weren't found in your shop.", "INVALID_PRODUCTS");
  }
  const inactive = productIds.filter((id) => found.get(id)!.status !== "active");
  if (inactive.length > 0) {
    const names = inactive.map((id) => found.get(id)!.title).join(", ");
    throw new CheckoutLinkError(`Publish these products first: ${names}.`, "INVALID_PRODUCTS");
  }

  // Delivery and payment must be things the shop actually offers.
  const options = await getCheckoutLinkShopOptions(tenantId);
  const deliveryMode = input.deliveryMode ?? "both";
  const deliveryOk =
    (deliveryMode !== "pickup" && options.deliveryEnabled) ||
    (deliveryMode !== "delivery" && options.pickupEnabled);
  if (!deliveryOk) {
    throw new CheckoutLinkError(
      deliveryMode === "pickup"
        ? "Pickup is off for your shop. Turn it on in Settings → Delivery, or choose delivery."
        : "Delivery is off for your shop. Turn it on in Settings → Delivery, or choose pickup.",
      "NO_DELIVERY_OPTION"
    );
  }

  const shopMethods = new Set(options.paymentMethods.map((m) => m.id));
  let paymentMethods: CheckoutLinkPaymentMethod[] | null = null;
  if (input.paymentMethods && input.paymentMethods.length > 0) {
    paymentMethods = [...new Set(input.paymentMethods)].filter((m) => shopMethods.has(m));
    if (paymentMethods.length === 0) {
      throw new CheckoutLinkError("Choose at least one payment method your shop accepts.", "NO_PAYMENT_METHOD");
    }
    // Every shop method allowed = same as "all" (so new methods show up later too).
    if (paymentMethods.length === shopMethods.size) paymentMethods = null;
  } else if (shopMethods.size === 0) {
    throw new CheckoutLinkError(
      "Your shop has no payment method turned on. Set one up in Settings → Payments.",
      "NO_PAYMENT_METHOD"
    );
  }

  const firstTitle = found.get(productIds[0]!)!.title;
  const title =
    input.title?.trim() ||
    (productIds.length === 1 ? firstTitle : `${firstTitle} + ${productIds.length - 1} more`);

  let linkId: string | null = null;
  for (let attempt = 0; attempt < 5 && !linkId; attempt++) {
    try {
      linkId = await db.transaction(async (tx) => {
        const [link] = await tx
          .insert(checkoutLinks)
          .values({
            tenantId,
            code: generateCheckoutLinkCode(),
            title: title.slice(0, 120),
            shareChannel: input.shareChannel ?? null,
            allowQuantityEdit: input.allowQuantityEdit ?? true,
            deliveryMode,
            paymentMethods,
            expiresAt: input.expiresAt ?? null,
            maxOrders: input.maxOrders ?? null,
            createdBy: userId,
          })
          .returning({ id: checkoutLinks.id });
        await tx.insert(checkoutLinkItems).values(
          productIds.map((productId, index) => ({
            linkId: link!.id,
            productId,
            variantId: found.get(productId)!.variantId,
            quantity: merged.get(productId)!,
            sortOrder: index,
          }))
        );
        return link!.id;
      });
    } catch (error) {
      // Code collision (1 in ~27 billion per pair) — try a new code.
      if (isUniqueViolation(error, "checkout_links_code_idx")) continue;
      throw error;
    }
  }
  if (!linkId) throw new Error("Could not create a unique checkout link code.");

  const created = await getCheckoutLinkForTenant(tenantId, linkId);
  return created!;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint_name?: string; cause?: unknown };
  if (e?.code === "23505" && (!e.constraint_name || e.constraint_name === constraint)) return true;
  return e?.cause ? isUniqueViolation(e.cause, constraint) : false;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export interface CheckoutLinkItemSummary {
  productId: string;
  variantId: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  /** Current price (string decimal): what checkout will charge per unit. */
  price: string;
  imageUrl: string | null;
  stockQty: number | null;
  trackInventory: boolean;
  productActive: boolean;
}

export interface CheckoutLinkSummary {
  id: string;
  code: string;
  title: string;
  shareChannel: CheckoutLinkShareChannel | null;
  allowQuantityEdit: boolean;
  deliveryMode: CheckoutLinkDeliveryMode;
  paymentMethods: CheckoutLinkPaymentMethod[] | null;
  expiresAt: Date | null;
  maxOrders: number | null;
  active: boolean;
  status: CheckoutLinkStatus;
  viewCount: number;
  startCount: number;
  orderCount: number;
  /** Sum of non-cancelled orders placed through this link. */
  salesTotal: number;
  createdAt: Date;
  items: CheckoutLinkItemSummary[];
}

type LinkRow = typeof checkoutLinks.$inferSelect;

async function loadItems(linkIds: string[]): Promise<Map<string, CheckoutLinkItemSummary[]>> {
  const byLink = new Map<string, CheckoutLinkItemSummary[]>();
  if (linkIds.length === 0) return byLink;
  const db = getDb();
  const rows = await db
    .select({
      linkId: checkoutLinkItems.linkId,
      productId: checkoutLinkItems.productId,
      variantId: checkoutLinkItems.variantId,
      quantity: checkoutLinkItems.quantity,
      title: products.title,
      productStatus: products.status,
      basePrice: products.basePrice,
      trackInventory: products.trackInventory,
      variantTitle: productVariants.title,
      stockQty: productVariants.stockQty,
      variantImage: productVariants.imageUrl,
      firstImage: sql<string | null>`(
        select ${productImages.url} from ${productImages}
        where ${productImages.productId} = ${checkoutLinkItems.productId}
        order by ${productImages.sortOrder} asc nulls last
        limit 1
      )`,
    })
    .from(checkoutLinkItems)
    .innerJoin(products, eq(products.id, checkoutLinkItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, checkoutLinkItems.variantId))
    .where(inArray(checkoutLinkItems.linkId, linkIds))
    .orderBy(asc(checkoutLinkItems.linkId), asc(checkoutLinkItems.sortOrder));

  for (const row of rows) {
    const list = byLink.get(row.linkId) ?? [];
    list.push({
      productId: row.productId,
      variantId: row.variantId,
      title: row.title,
      // "Default" variants carry the product title; only show real variant names.
      variantTitle:
        row.variantTitle && row.variantTitle !== row.title && row.variantTitle.toLowerCase() !== "default"
          ? row.variantTitle
          : null,
      quantity: row.quantity,
      // Checkout charges products.base_price (kept in sync with the default
      // variant by products.ts), so show exactly that.
      price: row.basePrice,
      imageUrl: row.variantImage ?? row.firstImage ?? null,
      stockQty: row.variantId ? (row.stockQty ?? 0) : null,
      trackInventory: row.trackInventory !== false,
      productActive: row.productStatus === "active",
    });
    byLink.set(row.linkId, list);
  }
  return byLink;
}

async function loadSales(linkIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (linkIds.length === 0) return totals;
  const db = getDb();
  const rows = await db
    .select({
      linkId: orders.checkoutLinkId,
      total: sql<string>`coalesce(sum(${orders.total}), 0)`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.checkoutLinkId, linkIds),
        sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`
      )
    )
    .groupBy(orders.checkoutLinkId);
  for (const row of rows) if (row.linkId) totals.set(row.linkId, Number(row.total));
  return totals;
}

function summarize(
  row: LinkRow,
  items: CheckoutLinkItemSummary[],
  salesTotal: number,
  now: Date
): CheckoutLinkSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    shareChannel: (row.shareChannel as CheckoutLinkShareChannel | null) ?? null,
    allowQuantityEdit: row.allowQuantityEdit,
    deliveryMode: row.deliveryMode as CheckoutLinkDeliveryMode,
    paymentMethods: (row.paymentMethods as CheckoutLinkPaymentMethod[] | null) ?? null,
    expiresAt: row.expiresAt,
    maxOrders: row.maxOrders,
    active: row.active,
    status: checkoutLinkStatus(row, now),
    viewCount: row.viewCount,
    startCount: row.startCount,
    orderCount: row.orderCount,
    salesTotal,
    createdAt: row.createdAt,
    items,
  };
}

export async function listCheckoutLinksForTenant(
  tenantId: string,
  options: { limit?: number } = {}
): Promise<CheckoutLinkSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(checkoutLinks)
    .where(eq(checkoutLinks.tenantId, tenantId))
    .orderBy(desc(checkoutLinks.createdAt))
    .limit(Math.min(options.limit ?? 200, 500));
  const ids = rows.map((r) => r.id);
  const [items, sales] = await Promise.all([loadItems(ids), loadSales(ids)]);
  const now = new Date();
  return rows.map((row) => summarize(row, items.get(row.id) ?? [], sales.get(row.id) ?? 0, now));
}

export async function getCheckoutLinkForTenant(
  tenantId: string,
  linkId: string
): Promise<CheckoutLinkSummary | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(checkoutLinks)
    .where(and(eq(checkoutLinks.tenantId, tenantId), eq(checkoutLinks.id, linkId)))
    .limit(1);
  if (!row) return null;
  const [items, sales] = await Promise.all([loadItems([row.id]), loadSales([row.id])]);
  return summarize(row, items.get(row.id) ?? [], sales.get(row.id) ?? 0, new Date());
}

// ─── Update ──────────────────────────────────────────────────────────────────

export interface UpdateCheckoutLinkInput {
  title?: string;
  active?: boolean;
  shareChannel?: CheckoutLinkShareChannel | null;
  expiresAt?: Date | null;
  maxOrders?: number | null;
}

/** Only settings that don't change what a buyer pays; items are fixed once shared. */
export async function updateCheckoutLink(
  tenantId: string,
  linkId: string,
  input: UpdateCheckoutLinkInput
): Promise<CheckoutLinkSummary | null> {
  const db = getDb();
  const patch: Partial<typeof checkoutLinks.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 120) || "Checkout link";
  if (input.active !== undefined) patch.active = input.active;
  if (input.shareChannel !== undefined) patch.shareChannel = input.shareChannel;
  if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt;
  if (input.maxOrders !== undefined) patch.maxOrders = input.maxOrders;

  const updated = await db
    .update(checkoutLinks)
    .set(patch)
    .where(and(eq(checkoutLinks.tenantId, tenantId), eq(checkoutLinks.id, linkId)))
    .returning({ id: checkoutLinks.id });
  if (updated.length === 0) return null;
  return getCheckoutLinkForTenant(tenantId, linkId);
}

// ─── Buyer side (public, by code) ────────────────────────────────────────────

export interface PublicCheckoutLink {
  id: string;
  code: string;
  tenantId: string;
  tenantSlug: string;
  tenantStatus: string;
  shareChannel: CheckoutLinkShareChannel | null;
  allowQuantityEdit: boolean;
  deliveryMode: CheckoutLinkDeliveryMode;
  paymentMethods: CheckoutLinkPaymentMethod[] | null;
  couponCode: string | null;
  status: CheckoutLinkStatus;
  items: CheckoutLinkItemSummary[];
}

/** Looks a link up by its public code. Returns closed links too (status says why). */
export async function getCheckoutLinkByCode(rawCode: string): Promise<PublicCheckoutLink | null> {
  const code = rawCode.trim().toLowerCase();
  if (!isCheckoutLinkCode(code)) return null;
  const db = getDb();
  const [row] = await db
    .select({ link: checkoutLinks, tenantSlug: tenants.slug, tenantStatus: tenants.status })
    .from(checkoutLinks)
    .innerJoin(tenants, eq(tenants.id, checkoutLinks.tenantId))
    .where(eq(checkoutLinks.code, code))
    .limit(1);
  if (!row) return null;
  const items = (await loadItems([row.link.id])).get(row.link.id) ?? [];
  return {
    id: row.link.id,
    code: row.link.code,
    tenantId: row.link.tenantId,
    tenantSlug: row.tenantSlug,
    tenantStatus: row.tenantStatus,
    shareChannel: (row.link.shareChannel as CheckoutLinkShareChannel | null) ?? null,
    allowQuantityEdit: row.link.allowQuantityEdit,
    deliveryMode: row.link.deliveryMode as CheckoutLinkDeliveryMode,
    paymentMethods: (row.link.paymentMethods as CheckoutLinkPaymentMethod[] | null) ?? null,
    couponCode: row.link.couponCode,
    status: checkoutLinkStatus(row.link),
    items,
  };
}

/** Best-effort counters for the seller's link stats. Never throws. */
export async function bumpCheckoutLinkCounter(linkId: string, counter: "view" | "start"): Promise<void> {
  const db = getDb();
  const column = counter === "view" ? checkoutLinks.viewCount : checkoutLinks.startCount;
  await db
    .update(checkoutLinks)
    .set(counter === "view" ? { viewCount: sql`${column} + 1` } : { startCount: sql`${column} + 1` })
    .where(eq(checkoutLinks.id, linkId))
    .catch((error) => console.error("[checkout-links] counter failed:", error));
}
