import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import { checkoutSessions, tenants } from "../schema/index";
import {
  checkoutFromLegacySettings,
  normalizeCheckoutJson,
  EMPTY_CHECKOUT,
  type TenantCheckoutJson,
} from "../types/tenant-checkout";

export type { TenantCheckoutJson };
export {
  EMPTY_CHECKOUT,
  normalizeCheckoutJson,
  checkoutFromLegacySettings,
  computeCheckoutTotals,
  findActiveCoupon,
  isPaymentMethodEnabled,
} from "../types/tenant-checkout";

export interface TenantCheckoutState {
  tenantId: string;
  slug: string;
  name: string;
  draft: TenantCheckoutJson;
  published: TenantCheckoutJson;
}

export async function getTenantCheckoutState(
  tenantId: string
): Promise<TenantCheckoutState | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      settingsJson: tenants.settingsJson,
      checkoutDraftJson: tenants.checkoutDraftJson,
      checkoutPublishedJson: tenants.checkoutPublishedJson,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) return null;

  const legacy = checkoutFromLegacySettings(row.settingsJson);
  const published = row.checkoutPublishedJson
    ? normalizeCheckoutJson(row.checkoutPublishedJson)
    : legacy;
  const draft = row.checkoutDraftJson
    ? normalizeCheckoutJson(row.checkoutDraftJson)
    : { ...published };

  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    draft,
    published,
  };
}

export async function saveTenantCheckoutDraft(
  tenantId: string,
  checkout: TenantCheckoutJson
): Promise<TenantCheckoutJson> {
  const db = getDb();
  const normalized = normalizeCheckoutJson(checkout);
  await db
    .update(tenants)
    .set({ checkoutDraftJson: normalized, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  return normalized;
}

/**
 * Publish checkout config and mirror COD / min-order / auto-accept into
 * settings_json so existing storefront readers stay compatible.
 */
export async function publishTenantCheckout(
  tenantId: string,
  checkout: TenantCheckoutJson
): Promise<TenantCheckoutJson> {
  const db = getDb();
  const normalized = normalizeCheckoutJson(checkout);

  const [row] = await db
    .select({ settingsJson: tenants.settingsJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const prev = (row?.settingsJson ?? {}) as Record<string, unknown>;
  const settingsJson = {
    ...prev,
    codEnabled: normalized.codEnabled,
    minOrderAmount: normalized.minOrderAmount,
    autoAcceptOrders: normalized.autoAcceptOrders,
  };

  await db
    .update(tenants)
    .set({
      checkoutDraftJson: normalized,
      checkoutPublishedJson: normalized,
      settingsJson,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return normalized;
}

export async function getPublishedCheckoutForSlug(
  slug: string
): Promise<TenantCheckoutJson | null> {
  const db = getDb();
  const [row] = await db
    .select({
      settingsJson: tenants.settingsJson,
      checkoutPublishedJson: tenants.checkoutPublishedJson,
      status: tenants.status,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!row || row.status !== "active") return null;
  if (row.checkoutPublishedJson) return normalizeCheckoutJson(row.checkoutPublishedJson);
  return checkoutFromLegacySettings(row.settingsJson);
}

export interface UpsertCheckoutSessionInput {
  tenantId: string;
  sessionKey: string;
  cartJson?: unknown;
  customerJson?: unknown;
  addressJson?: unknown;
  couponCode?: string | null;
  /** Buyer phone, kept for checkout recovery (only messaged with consent). */
  phone?: string | null;
  /** "Text me reminders about this order" checkbox. */
  marketingConsent?: boolean;
  sourceChannel?: string | null;
  utmJson?: Record<string, unknown> | null;
}

export async function upsertCheckoutSession(input: UpsertCheckoutSessionInput) {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.tenantId, input.tenantId),
        eq(checkoutSessions.sessionKey, input.sessionKey)
      )
    )
    .limit(1);

  if (existing) {
    if (existing.status === "converted") return existing;
    const [updated] = await db
      .update(checkoutSessions)
      .set({
        cartJson: (input.cartJson as Record<string, unknown>) ?? existing.cartJson,
        customerJson:
          (input.customerJson as Record<string, unknown>) ?? existing.customerJson,
        addressJson:
          (input.addressJson as Record<string, unknown>) ?? existing.addressJson,
        couponCode: input.couponCode !== undefined ? input.couponCode : existing.couponCode,
        ...(input.phone ? { phone: input.phone.slice(0, 20) } : {}),
        ...(input.marketingConsent !== undefined ? { marketingConsent: input.marketingConsent } : {}),
        ...(input.sourceChannel ? { sourceChannel: input.sourceChannel } : {}),
        ...(input.utmJson ? { utmJson: input.utmJson } : {}),
        status: "active",
        lastActivityAt: now,
        abandonedAt: null,
      })
      .where(eq(checkoutSessions.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(checkoutSessions)
    .values({
      tenantId: input.tenantId,
      sessionKey: input.sessionKey,
      cartJson: (input.cartJson as Record<string, unknown>) ?? null,
      customerJson: (input.customerJson as Record<string, unknown>) ?? null,
      addressJson: (input.addressJson as Record<string, unknown>) ?? null,
      couponCode: input.couponCode ?? null,
      phone: input.phone?.slice(0, 20) ?? null,
      marketingConsent: input.marketingConsent ?? false,
      sourceChannel: input.sourceChannel ?? null,
      utmJson: input.utmJson ?? null,
      status: "active",
      lastActivityAt: now,
    })
    // Two saves from the same browser can race; the loser updates instead.
    .onConflictDoNothing({ target: [checkoutSessions.tenantId, checkoutSessions.sessionKey] })
    .returning();
  if (!created) return upsertCheckoutSession(input);
  return created;
}

export async function markCheckoutSessionConverted(input: {
  tenantId: string;
  sessionKey: string;
  orderId: string;
}) {
  const db = getDb();
  await db
    .update(checkoutSessions)
    .set({
      status: "converted",
      convertedOrderId: input.orderId,
      lastActivityAt: new Date(),
    })
    .where(
      and(
        eq(checkoutSessions.tenantId, input.tenantId),
        eq(checkoutSessions.sessionKey, input.sessionKey)
      )
    );
}

export async function abandonStaleCheckoutSessions(input: {
  tenantId: string;
  abandonedAfterMinutes: number;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    sessionKey: string;
    cartJson: unknown;
    customerJson: unknown;
  }>
> {
  const db = getDb();
  const cutoff = new Date(Date.now() - input.abandonedAfterMinutes * 60_000);
  const stale = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.tenantId, input.tenantId),
        eq(checkoutSessions.status, "active"),
        lt(checkoutSessions.lastActivityAt, cutoff),
        sql`jsonb_typeof(${checkoutSessions.cartJson}) = 'array' AND jsonb_array_length(${checkoutSessions.cartJson}) > 0`
      )
    )
    .limit(input.limit ?? 50);

  const abandoned: Array<{
    id: string;
    sessionKey: string;
    cartJson: unknown;
    customerJson: unknown;
  }> = [];

  for (const row of stale) {
    const [updated] = await db
      .update(checkoutSessions)
      .set({ status: "abandoned", abandonedAt: new Date() })
      .where(eq(checkoutSessions.id, row.id))
      .returning();
    if (updated) {
      abandoned.push({
        id: updated.id,
        sessionKey: updated.sessionKey,
        cartJson: updated.cartJson,
        customerJson: updated.customerJson,
      });
    }
  }

  return abandoned;
}

/** True when this browser already has a checkout session with the shop. */
export async function checkoutSessionExists(tenantId: string, sessionKey: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.tenantId, tenantId), eq(checkoutSessions.sessionKey, sessionKey)))
    .limit(1);
  return Boolean(row);
}
