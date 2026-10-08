import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  contentQueue,
  kycVerificationSessions,
  orders,
  platformAuditLog,
  products,
  supportTickets,
  templateStock,
  tenants,
  users,
} from "../schema/index";
import {
  PLATFORM_PLANS as SELLER_PLATFORM_PLANS,
  getSellerPlan,
  planPriceMonthly,
  type PlanDefinition,
} from "../plans";

// ─── Plan catalog (re-export single source of truth) ───────────────────────

export type PlatformPlan = Pick<PlanDefinition, "id" | "name" | "priceMonthly" | "tagline" | "features">;
export const PLATFORM_PLANS: PlatformPlan[] = SELLER_PLATFORM_PLANS;

export function getPlanById(id: string | null | undefined): PlatformPlan {
  return getSellerPlan(id);
}

export function planPrice(id: string | null | undefined): number {
  return planPriceMonthly(id);
}

export const TENANT_STATUSES = ["active", "pending", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Money actually received and kept (refunds excluded).
const PAID_ORDER = eq(orders.paymentState, "paid");

// ─── Dashboard stats ───────────────────────────────────────────────────────

export interface PlatformStats {
  tenantCount: number;
  activeTenantCount: number;
  pendingTenantCount: number;
  suspendedTenantCount: number;
  userCount: number;
  sellerCount: number;
  orderCount: number;
  gmv: number;
  mrr: number;
  paidTenantCount: number;
  newTenants30d: number;
  planDistribution: { plan: string; count: number }[];
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const db = getDb();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [tenantRows, userRows, orderAgg, planRows, new30] = await Promise.all([
    db.select({ status: tenants.status, n: count() }).from(tenants).groupBy(tenants.status),
    db.select({ role: users.role, n: count() }).from(users).groupBy(users.role),
    db
      .select({
        n: count(),
        gmv: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(PAID_ORDER),
    db
      .select({ plan: tenants.subscriptionPlan, n: count() })
      .from(tenants)
      .groupBy(tenants.subscriptionPlan),
    db
      .select({ n: count() })
      .from(tenants)
      .where(gte(tenants.createdAt, since30)),
  ]);

  const statusMap = new Map(tenantRows.map((r) => [r.status, r.n]));
  const tenantCount = tenantRows.reduce((sum, r) => sum + r.n, 0);
  const userCount = userRows.reduce((sum, r) => sum + r.n, 0);
  const sellerCount = userRows
    .filter((r) => r.role === "seller_owner" || r.role === "seller_staff")
    .reduce((sum, r) => sum + r.n, 0);

  const planDistribution = planRows
    .map((r) => ({ plan: r.plan ?? "free", count: r.n }))
    .sort((a, b) => planPrice(b.plan) - planPrice(a.plan));

  const mrr = planDistribution.reduce((sum, r) => sum + planPrice(r.plan) * r.count, 0);
  const paidTenantCount = planDistribution
    .filter((r) => planPrice(r.plan) > 0)
    .reduce((sum, r) => sum + r.count, 0);

  return {
    tenantCount,
    activeTenantCount: statusMap.get("active") ?? 0,
    pendingTenantCount: statusMap.get("pending") ?? 0,
    suspendedTenantCount: statusMap.get("suspended") ?? 0,
    userCount,
    sellerCount,
    orderCount: toNumber(orderAgg[0]?.n),
    gmv: toNumber(orderAgg[0]?.gmv),
    mrr,
    paidTenantCount,
    newTenants30d: toNumber(new30[0]?.n),
    planDistribution,
  };
}

export interface DailyPoint {
  date: string;
  value: number;
}

export async function getSignupSeries(days = 30): Promise<DailyPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${tenants.createdAt}, 'YYYY-MM-DD')`,
      n: count(),
    })
    .from(tenants)
    .where(gte(tenants.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return fillSeries(rows.map((r) => ({ date: r.day, value: r.n })), days);
}

export async function getRevenueSeries(days = 30): Promise<DailyPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      value: sql<string>`coalesce(sum(${orders.total}), 0)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, since), PAID_ORDER))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return fillSeries(rows.map((r) => ({ date: r.day, value: toNumber(r.value) })), days);
}

function fillSeries(points: DailyPoint[], days: number): DailyPoint[] {
  const map = new Map(points.map((p) => [p.date, p.value]));
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, value: map.get(key) ?? 0 });
  }
  return out;
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  status: string;
  plan: string;
  logoUrl: string | null;
  createdAt: Date;
  ownerEmail: string | null;
  ownerName: string | null;
  productCount: number;
  orderCount: number;
  gmv: number;
}

export interface ListTenantsFilters {
  search?: string;
  status?: string;
  plan?: string;
}

export async function listTenants(filters: ListTenantsFilters = {}): Promise<TenantListItem[]> {
  const db = getDb();
  const conditions = [];
  if (filters.search) {
    conditions.push(
      or(ilike(tenants.name, `%${filters.search}%`), ilike(tenants.slug, `%${filters.search}%`))
    );
  }
  if (filters.status) conditions.push(eq(tenants.status, filters.status));
  if (filters.plan) conditions.push(eq(tenants.subscriptionPlan, filters.plan));

  const tenantRows = await db
    .select()
    .from(tenants)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tenants.createdAt));

  if (tenantRows.length === 0) return [];
  const ids = tenantRows.map((t) => t.id);

  const [owners, productCounts, orderStats] = await Promise.all([
    db
      .select({
        tenantId: users.tenantId,
        email: users.email,
        profileJson: users.profileJson,
      })
      .from(users)
      .where(and(inArray(users.tenantId, ids), eq(users.role, "seller_owner"))),
    db
      .select({ tenantId: products.tenantId, n: count() })
      .from(products)
      .where(inArray(products.tenantId, ids))
      .groupBy(products.tenantId),
    db
      .select({
        tenantId: orders.tenantId,
        n: count(),
        gmv: sql<string>`coalesce(sum(case when ${PAID_ORDER} then ${orders.total} else 0 end), 0)`,
      })
      .from(orders)
      .where(inArray(orders.tenantId, ids))
      .groupBy(orders.tenantId),
  ]);

  const ownerMap = new Map(owners.map((o) => [o.tenantId, o]));
  const productMap = new Map(productCounts.map((p) => [p.tenantId, p.n]));
  const orderMap = new Map(orderStats.map((o) => [o.tenantId, o]));

  return tenantRows.map((t) => {
    const owner = ownerMap.get(t.id);
    const orderStat = orderMap.get(t.id);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      category: t.category,
      status: t.status,
      plan: t.subscriptionPlan ?? "free",
      logoUrl: t.logoUrl,
      createdAt: t.createdAt,
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.profileJson?.displayName ?? null,
      productCount: productMap.get(t.id) ?? 0,
      orderCount: toNumber(orderStat?.n),
      gmv: toNumber(orderStat?.gmv),
    };
  });
}

export interface TenantDetail extends TenantListItem {
  legalName: string | null;
  currency: string;
  timezone: string;
  activeProductCount: number;
  /** Explicit shop override; null = inherit platform/env default. */
  paymentsMode: "manual_ewallet" | "paymongo" | "both" | null;
  staff: { id: string; email: string | null; name: string | null; role: string; status: string }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    total: number;
    status: string;
    createdAt: Date;
  }[];
}

export async function getTenantDetail(id: string): Promise<TenantDetail | null> {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) return null;

  const [staff, productCounts, orderStat, recentOrders] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        profileJson: users.profileJson,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(eq(users.tenantId, id))
      .orderBy(desc(users.createdAt)),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${products.status} = 'active')`,
      })
      .from(products)
      .where(eq(products.tenantId, id)),
    db
      .select({
        n: count(),
        gmv: sql<string>`coalesce(sum(case when ${PAID_ORDER} then ${orders.total} else 0 end), 0)`,
      })
      .from(orders)
      .where(eq(orders.tenantId, id)),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.tenantId, id))
      .orderBy(desc(orders.createdAt))
      .limit(10),
  ]);

  const owner = staff.find((s) => s.role === "seller_owner");
  const payments = (tenant.settingsJson as { payments?: { mode?: string } } | null)?.payments;
  const modeRaw = payments?.mode;
  const paymentsMode =
    modeRaw === "manual_ewallet" || modeRaw === "paymongo" || modeRaw === "both"
      ? modeRaw
      : null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    legalName: tenant.legalName,
    category: tenant.category,
    status: tenant.status,
    plan: tenant.subscriptionPlan ?? "free",
    logoUrl: tenant.logoUrl,
    currency: tenant.currency,
    timezone: tenant.timezone,
    createdAt: tenant.createdAt,
    ownerEmail: owner?.email ?? null,
    ownerName: owner?.profileJson?.displayName ?? null,
    productCount: toNumber(productCounts[0]?.total),
    activeProductCount: toNumber(productCounts[0]?.active),
    orderCount: toNumber(orderStat[0]?.n),
    gmv: toNumber(orderStat[0]?.gmv),
    paymentsMode,
    staff: staff.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.profileJson?.displayName ?? null,
      role: s.role,
      status: s.status,
    })),
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      total: toNumber(o.total),
      status: o.status,
      createdAt: o.createdAt,
    })),
  };
}

export async function setTenantStatus(id: string, status: TenantStatus): Promise<void> {
  const db = getDb();
  await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, id));
}

export async function setTenantPlan(id: string, plan: string): Promise<void> {
  const db = getDb();
  await db
    .update(tenants)
    .set({ subscriptionPlan: plan, updatedAt: new Date() })
    .where(eq(tenants.id, id));
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface UserListItem {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  status: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  emailVerified: boolean;
  createdAt: Date;
}

export interface ListUsersFilters {
  search?: string;
  role?: string;
  status?: string;
}

export async function listUsers(filters: ListUsersFilters = {}): Promise<UserListItem[]> {
  const db = getDb();
  const conditions = [];
  if (filters.search) {
    conditions.push(ilike(users.email, `%${filters.search}%`));
  }
  if (filters.role) conditions.push(eq(users.role, filters.role as never));
  if (filters.status) conditions.push(eq(users.status, filters.status));

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      profileJson: users.profileJson,
      role: users.role,
      status: users.status,
      tenantId: users.tenantId,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(500);

  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.profileJson?.displayName ?? null,
    role: u.role,
    status: u.status,
    tenantId: u.tenantId,
    tenantName: u.tenantName,
    tenantSlug: u.tenantSlug,
    emailVerified: Boolean(u.emailVerifiedAt),
    createdAt: u.createdAt,
  }));
}

export async function getUserRoleCounts(): Promise<{ role: string; count: number }[]> {
  const db = getDb();
  const rows = await db.select({ role: users.role, n: count() }).from(users).groupBy(users.role);
  return rows.map((r) => ({ role: r.role, count: r.n }));
}

/**
 * Security G1 (GK-5): any status or role change bumps the session version, so every
 * session the user holds — seller console, ops, support access — ends at once instead
 * of running on for up to 7 days.
 */
export async function setUserStatus(id: string, status: UserStatus): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ status, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, id));
}

export async function setUserRole(id: string, role: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ role: role as never, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, id));
}

// ─── Content moderation ──────────────────────────────────────────────────────

export interface ModerationItem {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  platform: string;
  agentKey: string;
  title: string | null;
  body: string;
  mediaBrief: string | null;
  status: string;
  flagged: boolean;
  moderationNote: string | null;
  moderatedAt: Date | null;
  scheduledFor: Date | null;
  createdAt: Date;
}

export interface ListModerationFilters {
  status?: string;
  flaggedOnly?: boolean;
  search?: string;
}

export async function listModerationQueue(
  filters: ListModerationFilters = {}
): Promise<ModerationItem[]> {
  const db = getDb();
  const conditions = [];
  if (filters.status) conditions.push(eq(contentQueue.status, filters.status as never));
  if (filters.flaggedOnly) conditions.push(eq(contentQueue.flagged, true));
  if (filters.search) conditions.push(ilike(contentQueue.body, `%${filters.search}%`));

  const rows = await db
    .select({
      id: contentQueue.id,
      tenantId: contentQueue.tenantId,
      platform: contentQueue.platform,
      agentKey: contentQueue.agentKey,
      title: contentQueue.title,
      body: contentQueue.body,
      mediaBrief: contentQueue.mediaBrief,
      status: contentQueue.status,
      flagged: contentQueue.flagged,
      moderationNote: contentQueue.moderationNote,
      moderatedAt: contentQueue.moderatedAt,
      scheduledFor: contentQueue.scheduledFor,
      createdAt: contentQueue.createdAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(contentQueue)
    .leftJoin(tenants, eq(contentQueue.tenantId, tenants.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contentQueue.flagged), desc(contentQueue.createdAt))
    .limit(300);

  return rows;
}

export async function getModerationCounts(): Promise<{
  total: number;
  flagged: number;
  pending: number;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      total: count(),
      flagged: sql<number>`count(*) filter (where ${contentQueue.flagged} = true)`,
      pending: sql<number>`count(*) filter (where ${contentQueue.status} = 'draft')`,
    })
    .from(contentQueue);
  return {
    total: toNumber(row?.total),
    flagged: toNumber(row?.flagged),
    pending: toNumber(row?.pending),
  };
}

/** Ops dashboard “needs attention” counters — cross-tenant intervention cues. */
export type PlatformAttention = {
  openTickets: number;
  breachedTickets: number;
  pendingTenants: number;
  suspendedTenants: number;
  moderationPending: number;
  moderationFlagged: number;
  stockDrafts: number;
  /** KYC sessions waiting for platform review. */
  kycPending: number;
  /** Oldest waiting shop — the attention link goes straight to it. */
  kycOldestTenantId: string | null;
};

export async function getPlatformAttention(): Promise<PlatformAttention> {
  const db = getDb();
  const [ticketRow, tenantRow, mod, stockRow, kycRows] = await Promise.all([
    db
      .select({
        open: sql<number>`count(*) filter (where ${supportTickets.status} in ('open', 'pending', 'in_progress'))::int`,
        breached: sql<number>`count(*) filter (
          where ${supportTickets.status} not in ('resolved', 'closed')
          and (
            (${supportTickets.firstResponseAt} is null and ${supportTickets.slaFirstResponseDueAt} < now())
            or (${supportTickets.resolvedAt} is null and ${supportTickets.slaResolveDueAt} < now())
          )
        )::int`,
      })
      .from(supportTickets),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${tenants.status} = 'pending')::int`,
        suspended: sql<number>`count(*) filter (where ${tenants.status} = 'suspended')::int`,
      })
      .from(tenants),
    getModerationCounts(),
    db
      .select({
        drafts: sql<number>`count(*) filter (where ${templateStock.status} in ('draft', 'approved'))::int`,
      })
      .from(templateStock),
    db
      .select({ tenantId: kycVerificationSessions.tenantId })
      .from(kycVerificationSessions)
      .where(eq(kycVerificationSessions.status, "submitted"))
      .orderBy(kycVerificationSessions.submittedAt),
  ]);

  return {
    openTickets: toNumber(ticketRow[0]?.open),
    breachedTickets: toNumber(ticketRow[0]?.breached),
    pendingTenants: toNumber(tenantRow[0]?.pending),
    suspendedTenants: toNumber(tenantRow[0]?.suspended),
    moderationPending: mod.pending,
    moderationFlagged: mod.flagged,
    stockDrafts: toNumber(stockRow[0]?.drafts),
    kycPending: kycRows.length,
    kycOldestTenantId: kycRows[0]?.tenantId ?? null,
  };
}

export interface ModerateInput {
  status?: "draft" | "approved" | "skipped";
  flagged?: boolean;
  note?: string | null;
  moderatorId: string;
}

export async function moderateContentItem(id: string, input: ModerateInput): Promise<void> {
  const db = getDb();
  const set: Record<string, unknown> = {
    moderatedBy: input.moderatorId,
    moderatedAt: new Date(),
  };
  if (input.status !== undefined) set.status = input.status;
  if (input.flagged !== undefined) set.flagged = input.flagged;
  if (input.note !== undefined) set.moderationNote = input.note;
  await db.update(contentQueue).set(set).where(eq(contentQueue.id, id));
}

// ─── Platform orders ─────────────────────────────────────────────────────────

export interface PlatformOrderItem {
  id: string;
  orderNumber: string;
  tenantName: string | null;
  tenantSlug: string | null;
  total: number;
  /** order_state: open / completed / cancelled */
  status: string;
  /** payment_state */
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  customerName: string | null;
  createdAt: Date;
}

export async function listPlatformOrders(
  filters: { status?: string; search?: string } = {}
): Promise<PlatformOrderItem[]> {
  const db = getDb();
  const conditions = [];
  // `status` filters on the Phase 2 order state (open / completed / cancelled).
  if (filters.status) conditions.push(eq(orders.orderState, filters.status as never));
  if (filters.search) conditions.push(ilike(orders.orderNumber, `%${filters.search}%`));

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      total: orders.total,
      status: orders.orderState,
      paymentStatus: orders.paymentState,
      fulfillmentStatus: orders.fulfillmentState,
      guestName: orders.guestName,
      createdAt: orders.createdAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(orders)
    .leftJoin(tenants, eq(orders.tenantId, tenants.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(200);

  return rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    tenantName: o.tenantName,
    tenantSlug: o.tenantSlug,
    total: toNumber(o.total),
    status: o.status ?? "open",
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    customerName: o.guestName,
    createdAt: o.createdAt,
  }));
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  metadata?: Record<string, unknown>;
  tenantId?: string | null;
  actorType?: "user" | "ai" | "system";
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const db = getDb();
  await db.insert(platformAuditLog).values({
    tenantId: entry.tenantId ?? null,
    actorType: entry.actorType ?? "user",
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel ?? null,
    metadataJson: entry.metadata ?? null,
  });
}

export interface AuditLogItem {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export async function listAuditLog(limit = 100): Promise<AuditLogItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(platformAuditLog)
    .orderBy(desc(platformAuditLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actorEmail,
    action: r.action,
    entityType: r.entityType,
    entityLabel: r.entityLabel,
    metadata: r.metadataJson,
    createdAt: r.createdAt,
  }));
}
