import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  checkoutLinkItems,
  checkoutLinks,
  checkoutSessions,
  customers,
  deliveries,
  messageLog,
  orders,
  products,
  tenants,
} from "../schema/index";
import { factsOf } from "./order-lifecycle";
import type { TenantSettingsJson } from "../types/tenant-settings";

/**
 * Data access for the automatic SMS recipes (plan Phase 4). The sending itself
 * lives in the admin app (outbox consumer + timed scan); this file only reads
 * candidates and claims steps so two cron runs can't both text a buyer.
 */

/** Last 10 digits — compares 0917…, +63917…, 63917… as the same number. */
const tail10 = (col: unknown) => sql`right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 10)`;

export interface OrderMessagingContext {
  orderId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  settings: TenantSettingsJson;
  orderNumber: string;
  total: string;
  paymentMethod: string;
  deliveryType: string;
  buyerName: string | null;
  phone: string | null;
  accessToken: string;
  orderState: string;
  paymentState: string;
  fulfillmentState: string;
  courier: string | null;
  createdAt: Date;
}

const COURIER_NAMES: Record<string, string> = {
  lalamove: "Lalamove",
  grab: "GrabExpress",
  bayango: "BayanGo",
  manual: "",
};

export async function getOrderMessagingContext(orderId: string): Promise<OrderMessagingContext | null> {
  const db = getDb();
  const [row] = await db
    .select({ order: orders, tenant: { name: tenants.name, slug: tenants.slug, status: tenants.status, settingsJson: tenants.settingsJson } })
    .from(orders)
    .innerJoin(tenants, eq(orders.tenantId, tenants.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) return null;
  const [delivery] = await db
    .select({ provider: deliveries.provider })
    .from(deliveries)
    .where(eq(deliveries.orderId, orderId))
    .orderBy(desc(deliveries.bookedAt))
    .limit(1);
  const facts = factsOf(row.order);
  return {
    orderId: row.order.id,
    tenantId: row.order.tenantId,
    tenantName: row.tenant.name,
    tenantSlug: row.tenant.slug,
    tenantStatus: row.tenant.status,
    settings: (row.tenant.settingsJson ?? {}) as TenantSettingsJson,
    orderNumber: row.order.orderNumber,
    total: row.order.total,
    paymentMethod: row.order.paymentMethod ?? "",
    deliveryType: row.order.deliveryType ?? "delivery",
    buyerName: row.order.guestName,
    phone: row.order.guestPhone,
    accessToken: row.order.accessToken,
    orderState: facts.orderState,
    paymentState: facts.paymentState,
    fulfillmentState: facts.fulfillmentState,
    courier: delivery ? (COURIER_NAMES[delivery.provider] ?? delivery.provider) || null : null,
    createdAt: row.order.createdAt,
  };
}

// ─── Abandoned checkout (recipe 6) ───────────────────────────────────────────

export const RECOVERY_STEP_DELAYS_MINUTES = { 1: 30, 2: 24 * 60 } as const;

export interface RecoveryCandidate {
  sessionId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  settings: TenantSettingsJson;
  phone: string;
  cartJson: unknown;
  step: 1 | 2;
  lastActivityAt: Date;
}

/**
 * Sessions due for a recovery text: buyer ticked SMS reminders, typed a phone,
 * didn't order (this session, or any order from that phone at the shop since),
 * at most 2 texts. Step 1 after 30 min (only while the cart is < 12 h old),
 * step 2 after 24 h (only while < 72 h old).
 */
export async function listRecoveryCandidates(options: { now?: Date; limit?: number } = {}): Promise<RecoveryCandidate[]> {
  const db = getDb();
  const now = options.now ?? new Date();
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  const rows = await db
    .select({
      id: checkoutSessions.id,
      tenantId: checkoutSessions.tenantId,
      phone: checkoutSessions.phone,
      cartJson: checkoutSessions.cartJson,
      count: checkoutSessions.recoverySentCount,
      lastActivityAt: checkoutSessions.lastActivityAt,
      createdAt: checkoutSessions.createdAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      settingsJson: tenants.settingsJson,
    })
    .from(checkoutSessions)
    .innerJoin(tenants, eq(checkoutSessions.tenantId, tenants.id))
    .where(
      and(
        eq(checkoutSessions.marketingConsent, true),
        sql`length(${tail10(checkoutSessions.phone)}) = 10`,
        inArray(checkoutSessions.status, ["active", "abandoned"]),
        isNull(checkoutSessions.convertedOrderId),
        eq(tenants.status, "active"),
        or(
          and(
            eq(checkoutSessions.recoverySentCount, 0),
            lt(checkoutSessions.lastActivityAt, ago(RECOVERY_STEP_DELAYS_MINUTES[1])),
            gte(checkoutSessions.lastActivityAt, ago(12 * 60))
          ),
          and(
            lt(checkoutSessions.recoverySentCount, 2),
            lt(checkoutSessions.lastActivityAt, ago(RECOVERY_STEP_DELAYS_MINUTES[2])),
            gte(checkoutSessions.lastActivityAt, ago(72 * 60)),
            or(isNull(checkoutSessions.lastRecoveryAt), lt(checkoutSessions.lastRecoveryAt, ago(12 * 60)))
          )
        ),
        // Not if this phone ordered from the shop after starting this checkout.
        sql`not exists (
          select 1 from ${orders} o
          where o.tenant_id = ${checkoutSessions.tenantId}
            and o.created_at >= ${checkoutSessions.createdAt}
            and ${tail10(sql`o.guest_phone`)} = ${tail10(checkoutSessions.phone)}
        )`
      )
    )
    .orderBy(checkoutSessions.lastActivityAt)
    .limit(options.limit ?? 50);

  return rows.map((r) => ({
    sessionId: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    tenantSlug: r.tenantSlug,
    settings: (r.settingsJson ?? {}) as TenantSettingsJson,
    phone: r.phone!,
    cartJson: r.cartJson,
    // A 24 h-old cart that never got step 1 (quiet hours, recipe was off) gets the step-2 text only.
    step: r.lastActivityAt < ago(RECOVERY_STEP_DELAYS_MINUTES[2]) ? 2 : 1,
    lastActivityAt: r.lastActivityAt,
  }));
}

/**
 * Claims a recovery step (compare-and-set on the counter), so overlapping runs
 * never both send. Returns false when another run already took it.
 */
export async function claimRecoveryStep(sessionId: string, step: 1 | 2, now = new Date()): Promise<boolean> {
  const db = getDb();
  const claimed = await db
    .update(checkoutSessions)
    .set({
      recoverySentCount: step,
      lastRecoveryAt: now,
      status: "abandoned",
      abandonedAt: sql`coalesce(${checkoutSessions.abandonedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(checkoutSessions.id, sessionId),
        lt(checkoutSessions.recoverySentCount, step),
        isNull(checkoutSessions.convertedOrderId)
      )
    )
    .returning({ id: checkoutSessions.id });
  return claimed.length > 0;
}

/**
 * Where the recovery text sends the buyer, and what to call the cart.
 * Checkout-link sessions (`{ linkCode }`) go back to the link — only while it's
 * still live; storefront carts (array of items) go to the shop.
 */
export async function describeRecoveryCart(
  tenantId: string,
  tenantSlug: string,
  cartJson: unknown
): Promise<{ path: string; productTitle: string | null } | null> {
  const db = getDb();
  if (cartJson && typeof cartJson === "object" && !Array.isArray(cartJson)) {
    const code = (cartJson as { linkCode?: unknown }).linkCode;
    if (typeof code !== "string") return null;
    const [link] = await db
      .select({ id: checkoutLinks.id, active: checkoutLinks.active, expiresAt: checkoutLinks.expiresAt, maxOrders: checkoutLinks.maxOrders, orderCount: checkoutLinks.orderCount })
      .from(checkoutLinks)
      .where(and(eq(checkoutLinks.code, code), eq(checkoutLinks.tenantId, tenantId)))
      .limit(1);
    if (!link || !link.active) return null;
    if (link.expiresAt && link.expiresAt < new Date()) return null;
    if (link.maxOrders != null && link.orderCount >= link.maxOrders) return null;
    const [first] = await db
      .select({ title: products.title })
      .from(checkoutLinkItems)
      .innerJoin(products, eq(checkoutLinkItems.productId, products.id))
      .where(eq(checkoutLinkItems.linkId, link.id))
      .orderBy(checkoutLinkItems.sortOrder)
      .limit(1);
    return { path: `/c/${code}`, productTitle: first?.title ?? null };
  }
  if (Array.isArray(cartJson) && cartJson.length > 0) {
    const productId = (cartJson[0] as { productId?: unknown })?.productId;
    let title: string | null = null;
    if (typeof productId === "string" && /^[0-9a-f-]{36}$/i.test(productId)) {
      const [p] = await db
        .select({ title: products.title })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
        .limit(1);
      title = p?.title ?? null;
    }
    return { path: `/${tenantSlug}`, productTitle: title };
  }
  return null;
}

// ─── Unpaid reminder (recipe 7) ──────────────────────────────────────────────

export const UNPAID_REMINDER_AFTER_HOURS = 6;

export interface UnpaidReminderCandidate {
  orderId: string;
}

/**
 * E-wallet / online orders still unpaid 6 h after ordering (and < 48 h), where
 * the buyer ticked SMS reminders (customers.sms_marketing_opt_in).
 */
export async function listUnpaidReminderCandidates(options: { now?: Date; limit?: number } = {}): Promise<UnpaidReminderCandidate[]> {
  const db = getDb();
  const now = options.now ?? new Date();
  const rows = await db
    .select({ orderId: orders.id })
    .from(orders)
    .innerJoin(tenants, eq(orders.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.status, "active"),
        sql`coalesce(${orders.orderState}::text, 'open') = 'open'`,
        sql`${orders.paymentState}::text in ('unpaid', 'failed')`,
        ne(orders.paymentMethod, "cod"),
        lt(orders.createdAt, new Date(now.getTime() - UNPAID_REMINDER_AFTER_HOURS * 3_600_000)),
        gte(orders.createdAt, new Date(now.getTime() - 48 * 3_600_000)),
        sql`exists (
          select 1 from ${customers} c
          where c.tenant_id = ${orders.tenantId}
            and c.sms_marketing_opt_in = true
            and ${tail10(sql`c.phone`)} = ${tail10(orders.guestPhone)}
        )`,
        sql`not exists (
          select 1 from ${messageLog} m
          where m.idempotency_key = 'unpaid_reminder:' || ${orders.id}::text || ':1'
        )`
      )
    )
    .orderBy(orders.createdAt)
    .limit(options.limit ?? 50);
  return rows;
}

// ─── Seller view ─────────────────────────────────────────────────────────────

export interface TenantMessageItem {
  id: string;
  recipe: string;
  recipient: string;
  status: string;
  error: string | null;
  orderNumber: string | null;
  createdAt: Date;
}

/** Recent texts for the seller's Automations page. Recipients are masked. */
export async function listTenantMessages(tenantId: string, limit = 50): Promise<TenantMessageItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: messageLog.id,
      recipe: messageLog.recipe,
      recipient: messageLog.recipient,
      status: messageLog.status,
      error: messageLog.error,
      orderNumber: orders.orderNumber,
      createdAt: messageLog.createdAt,
    })
    .from(messageLog)
    .leftJoin(orders, eq(messageLog.orderId, orders.id))
    .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.channel, "sms")))
    .orderBy(desc(messageLog.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    ...r,
    recipient: r.recipient.length > 4 ? `${"•".repeat(Math.max(r.recipient.length - 4, 3))}${r.recipient.slice(-4)}` : r.recipient,
  }));
}

export interface AutomationSummary {
  sent30d: number;
  failed30d: number;
  byRecipe: Record<string, number>;
  recovered: { orders: number; sales: number };
}

export async function getAutomationSummary(tenantId: string, now = new Date()): Promise<AutomationSummary> {
  const db = getDb();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [byRecipe, [recovered]] = await Promise.all([
    db
      .select({
        recipe: messageLog.recipe,
        // Local/test mock sends are logged as "sent" with a note — count them apart.
        status: sql<string>`case when ${messageLog.status} = 'sent' and ${messageLog.error} like 'mock send%' then 'mock' else ${messageLog.status} end`,
        n: sql<number>`count(*)::int`,
      })
      .from(messageLog)
      .where(and(eq(messageLog.tenantId, tenantId), eq(messageLog.channel, "sms"), gte(messageLog.createdAt, since)))
      .groupBy(sql`1`, sql`2`),
    db
      .select({
        orders: sql<number>`count(*)::int`,
        sales: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(checkoutSessions)
      .innerJoin(orders, eq(checkoutSessions.convertedOrderId, orders.id))
      .where(
        and(
          eq(checkoutSessions.tenantId, tenantId),
          sql`${checkoutSessions.recoverySentCount} > 0`,
          gte(orders.createdAt, since),
          sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`
        )
      ),
  ]);
  const summary: AutomationSummary = { sent30d: 0, failed30d: 0, byRecipe: {}, recovered: { orders: 0, sales: 0 } };
  for (const row of byRecipe) {
    if (row.status === "sent" || row.status === "delivered") {
      summary.sent30d += row.n;
      summary.byRecipe[row.recipe] = (summary.byRecipe[row.recipe] ?? 0) + row.n;
    } else if (row.status === "failed") summary.failed30d += row.n;
  }
  summary.recovered = { orders: Number(recovered?.orders ?? 0), sales: Number(recovered?.sales ?? 0) };
  return summary;
}
