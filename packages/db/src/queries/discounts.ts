import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { orders, tenants } from "../schema/index";
import {
  checkoutFromLegacySettings,
  normalizeCheckoutJson,
  type CheckoutAutomaticDiscount,
  type CheckoutCoupon,
  type CheckoutVolumeDiscount,
  type TenantCheckoutJson,
} from "../types/tenant-checkout";

/**
 * Phase 14 — Discounts page. Coupons, the automatic order discount and quantity deals live
 * in the checkout config; this saves just those three fields into BOTH the published config
 * (what checkout uses right away) and the draft, leaving every other checkout setting alone.
 */

export interface DiscountSettings {
  coupons: CheckoutCoupon[];
  automaticDiscount: CheckoutAutomaticDiscount | null;
  volumeDiscounts: CheckoutVolumeDiscount[];
}

export interface CouponUsage {
  code: string;
  orders: number;
  sales: number;
  discount: number;
}

async function loadConfigs(tenantId: string) {
  const [row] = await getDb()
    .select({ settings: tenants.settingsJson, draft: tenants.checkoutDraftJson, published: tenants.checkoutPublishedJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) return null;
  const published = row.published ? normalizeCheckoutJson(row.published) : checkoutFromLegacySettings(row.settings as never);
  const draft = row.draft ? normalizeCheckoutJson(row.draft) : { ...published };
  return { published, draft };
}

export async function getDiscountSettings(tenantId: string): Promise<(DiscountSettings & { usage: CouponUsage[] }) | null> {
  const cfg = await loadConfigs(tenantId);
  if (!cfg) return null;
  const usage = (await getDb()
    .select({
      code: orders.couponCode,
      orders: sql<number>`count(*)::int`,
      sales: sql<string>`coalesce(sum(${orders.total} - coalesce(${orders.refundedAmount}, 0)), 0)`,
      discount: sql<string>`coalesce(sum(${orders.discount}), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), isNotNull(orders.couponCode), sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`))
    .groupBy(orders.couponCode)) as Array<{ code: string | null; orders: number; sales: string; discount: string }>;
  return {
    coupons: cfg.published.coupons ?? [],
    automaticDiscount: cfg.published.automaticDiscount ?? null,
    volumeDiscounts: cfg.published.volumeDiscounts ?? [],
    usage: usage.filter((u) => u.code).map((u) => ({ code: u.code!, orders: Number(u.orders), sales: Number(u.sales), discount: Number(u.discount) })),
  };
}

export async function saveDiscountSettings(tenantId: string, input: DiscountSettings): Promise<DiscountSettings> {
  const cfg = await loadConfigs(tenantId);
  if (!cfg) throw new Error("Shop not found.");
  const codes = input.coupons.map((c) => c.code.trim().toUpperCase());
  if (new Set(codes).size !== codes.length) throw new DiscountError("Two coupons have the same code.");
  const merge = (base: TenantCheckoutJson) =>
    normalizeCheckoutJson({ ...base, coupons: input.coupons, automaticDiscount: input.automaticDiscount, volumeDiscounts: input.volumeDiscounts });
  const published = merge(cfg.published);
  const draft = merge(cfg.draft);
  await getDb().update(tenants).set({ checkoutPublishedJson: published, checkoutDraftJson: draft, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return { coupons: published.coupons ?? [], automaticDiscount: published.automaticDiscount ?? null, volumeDiscounts: published.volumeDiscounts ?? [] };
}

export class DiscountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountError";
  }
}
