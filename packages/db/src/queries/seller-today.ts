import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../client";
import { checkoutLinks, orders, products, tenants } from "../schema/index";
import { factsOf } from "./order-lifecycle";
import { orderBucketOf, type OrderBucket } from "./order-state";
import { checkoutFromLegacySettings, normalizeCheckoutJson } from "../types/tenant-checkout";
import type { TenantSettingsJson } from "../types/tenant-settings";

/**
 * Plan §10 — the seller dashboard answers "What needs me today?":
 * to-do counts by order bucket, today's sales split by channel, deliveries in
 * motion, the newest checkout link, and the setup checklist for the new flow.
 */

export interface SellerToday {
  shop: { name: string; slug: string; status: string };
  todo: Record<"to_pay" | "to_confirm" | "to_pack" | "to_ship" | "attention", number>;
  today: {
    sales: number;
    orders: number;
    byChannel: { checkoutLinks: { orders: number; sales: number }; store: { orders: number; sales: number } };
  };
  deliveries: { booked: number; outForDelivery: number; deliveredToday: number };
  latestLink: { code: string; title: string; orderCount: number; viewCount: number } | null;
  linkCount: number;
  setup: Array<{ id: string; label: string; done: boolean; href: string; action: string; optional?: boolean }>;
}

/** Start of "today" in Manila (UTC+8, no DST). */
export function manilaStartOfDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 60 * 60 * 1000);
}

export async function getSellerToday(
  tenantId: string,
  options: { emailVerified: boolean; now?: Date }
): Promise<SellerToday | null> {
  const db = getDb();
  const [tenant] = await db
    .select({
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      settingsJson: tenants.settingsJson,
      checkoutPublishedJson: tenants.checkoutPublishedJson,
      themePublishedJson: tenants.themePublishedJson,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;

  const since = manilaStartOfDay(options.now);

  const [openRows, todayRows, deliveredToday, [productRow], links, [linkTotal]] = await Promise.all([
    // Open orders are what needs action; bounded by the shop's active work.
    db
      .select({
        orderState: orders.orderState,
        paymentState: orders.paymentState,
        fulfillmentState: orders.fulfillmentState,
        acceptedAt: orders.acceptedAt,
        paymentMethod: orders.paymentMethod,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), sql`coalesce(${orders.orderState}::text, 'open') = 'open'`))
      .limit(2000),
    db
      .select({
        channel: sql<string>`case when ${orders.sourceChannel} = 'checkout_link' then 'link' else 'store' end`,
        n: count(),
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          gte(orders.createdAt, since),
          sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`
        )
      )
      .groupBy(sql`1`),
    db
      .select({ n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.fulfillmentState, "delivered"),
          gte(orders.completedAt, since)
        )
      ),
    db
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.status, "active"))),
    db
      .select({
        code: checkoutLinks.code,
        title: checkoutLinks.title,
        orderCount: checkoutLinks.orderCount,
        viewCount: checkoutLinks.viewCount,
      })
      .from(checkoutLinks)
      .where(and(eq(checkoutLinks.tenantId, tenantId), eq(checkoutLinks.active, true)))
      .orderBy(desc(checkoutLinks.createdAt))
      .limit(1),
    db.select({ n: count() }).from(checkoutLinks).where(eq(checkoutLinks.tenantId, tenantId)),
  ]);

  const todo = { to_pay: 0, to_confirm: 0, to_pack: 0, to_ship: 0, attention: 0 };
  const deliveries = { booked: 0, outForDelivery: 0, deliveredToday: Number(deliveredToday[0]?.n ?? 0) };
  for (const row of openRows) {
    const facts = factsOf(row as Parameters<typeof factsOf>[0]);
    const bucket: OrderBucket = orderBucketOf(facts);
    if (bucket in todo) todo[bucket as keyof typeof todo] += 1;
    if (facts.fulfillmentState === "booked" || facts.fulfillmentState === "picked_up") deliveries.booked += 1;
    if (facts.fulfillmentState === "out_for_delivery") deliveries.outForDelivery += 1;
  }

  const byChannel = { checkoutLinks: { orders: 0, sales: 0 }, store: { orders: 0, sales: 0 } };
  for (const row of todayRows) {
    const target = row.channel === "link" ? byChannel.checkoutLinks : byChannel.store;
    target.orders += Number(row.n);
    target.sales += Number(row.total);
  }

  // Setup checklist for the new flow (plan §9). The online store is optional.
  const settings = (tenant.settingsJson ?? {}) as TenantSettingsJson;
  const checkout = tenant.checkoutPublishedJson
    ? normalizeCheckoutJson(tenant.checkoutPublishedJson)
    : checkoutFromLegacySettings(settings);
  const receiving = settings.payments?.receiving ?? {};
  // Ready when at least one way to pay actually works: an e-wallet number, or COD.
  const paymentsReady =
    Boolean(receiving.gcashNumber?.trim() || receiving.mayaNumber?.trim()) ||
    (checkout.codEnabled !== false && checkout.paymentAdapters?.cod !== false);
  const hasProduct = Number(productRow?.n ?? 0) > 0;
  const linkCount = Number(linkTotal?.n ?? 0);
  const storeBuilt = Boolean((tenant.themePublishedJson as { templateId?: string } | null)?.templateId);

  const setup: SellerToday["setup"] = [
    { id: "product", label: "Add your first product", done: hasProduct, href: "/products", action: "Add product" },
    { id: "payments", label: "Set how buyers pay you", done: paymentsReady, href: "/settings/payments", action: "Set up" },
    { id: "link", label: "Share your first checkout link", done: linkCount > 0, href: "/checkout-links", action: "Make a link" },
    { id: "email", label: "Confirm your email", done: options.emailVerified, href: "/verify-email", action: "Confirm" },
    {
      id: "store",
      label: "Build your online store",
      done: storeBuilt,
      href: "/launch",
      action: "Start",
      optional: true,
    },
  ];

  return {
    shop: { name: tenant.name, slug: tenant.slug, status: tenant.status },
    todo,
    today: {
      sales: byChannel.checkoutLinks.sales + byChannel.store.sales,
      orders: byChannel.checkoutLinks.orders + byChannel.store.orders,
      byChannel,
    },
    deliveries,
    latestLink: links[0] ?? null,
    linkCount,
    setup,
  };
}
