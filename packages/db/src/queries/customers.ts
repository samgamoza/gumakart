import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { customers, orders } from "../schema/index";

/** Statuses that don't count toward a customer's spend. */
// Cancelled (incl. refunded) orders don't count as spend.
const REVENUE_STATUS_SQL = sql`coalesce(${orders.orderState}::text, 'open') <> 'cancelled'`;

export interface CustomerSummary {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  ordersCount: number;
  totalSpent: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  isRepeat: boolean;
}

export interface CustomerDetail extends CustomerSummary {
  notes: string | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: string;
    createdAt: Date;
  }>;
}

export interface CustomerStats {
  totalCustomers: number;
  repeatCustomers: number;
  newThisMonth: number;
  repeatRate: number;
}

/**
 * List a tenant's customers with order count + spend computed from `orders`
 * (never denormalized, so it can't drift). Sort by recency, top spend, or orders.
 */
export async function listCustomersForTenant(
  tenantId: string,
  opts?: { search?: string; sort?: "recent" | "top" | "orders"; limit?: number }
): Promise<CustomerSummary[]> {
  const db = getDb();
  const limit = opts?.limit ?? 100;
  const search = opts?.search?.trim();

  const ordersCountExpr = sql<number>`count(${orders.id})::int`;
  const totalSpentExpr = sql<string>`coalesce(sum(case when ${REVENUE_STATUS_SQL} then ${orders.total} else 0 end), 0)`;

  const orderBy =
    opts?.sort === "top"
      ? desc(totalSpentExpr)
      : opts?.sort === "orders"
        ? desc(ordersCountExpr)
        : desc(customers.lastOrderAt);

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      firstOrderAt: customers.firstOrderAt,
      lastOrderAt: customers.lastOrderAt,
      ordersCount: ordersCountExpr,
      totalSpent: totalSpentExpr,
    })
    .from(customers)
    .leftJoin(orders, eq(orders.customerRecordId, customers.id))
    .where(
      search
        ? and(
            eq(customers.tenantId, tenantId),
            or(ilike(customers.name, `%${search}%`), ilike(customers.phone, `%${search}%`))
          )
        : eq(customers.tenantId, tenantId)
    )
    .groupBy(customers.id)
    .orderBy(orderBy)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    ordersCount: r.ordersCount,
    totalSpent: Number(r.totalSpent),
    firstOrderAt: r.firstOrderAt,
    lastOrderAt: r.lastOrderAt,
    isRepeat: r.ordersCount > 1,
  }));
}

/** One customer with their order history (tenant-scoped). */
export async function getCustomerForTenant(
  tenantId: string,
  customerId: string
): Promise<CustomerDetail | null> {
  const db = getDb();
  const [c] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  if (!c) return null;

  const orderRows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      orderState: orders.orderState,
      total: orders.total,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.customerRecordId, customerId)))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  const totalSpent = orderRows
    .filter((o) => o.orderState !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    firstOrderAt: c.firstOrderAt,
    lastOrderAt: c.lastOrderAt,
    ordersCount: orderRows.length,
    totalSpent,
    isRepeat: orderRows.length > 1,
    notes: c.notes,
    orders: orderRows,
  };
}

/** Headline CRM stats for the dashboard / customers page. */
export async function getCustomerStatsForTenant(tenantId: string): Promise<CustomerStats> {
  const db = getDb();

  const perCustomer = await db
    .select({ id: customers.id, cnt: sql<number>`count(${orders.id})::int` })
    .from(customers)
    .leftJoin(orders, eq(orders.customerRecordId, customers.id))
    .where(eq(customers.tenantId, tenantId))
    .groupBy(customers.id);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [newRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), gte(customers.createdAt, startOfMonth)));

  const totalCustomers = perCustomer.length;
  const repeatCustomers = perCustomer.filter((r) => r.cnt > 1).length;

  return {
    totalCustomers,
    repeatCustomers,
    newThisMonth: newRow?.n ?? 0,
    repeatRate: totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
  };
}

/**
 * Security G1 (GK-7): has this phone number ever placed an order at the shop? Used to decide
 * whether an abandoned-checkout text may go out — a stranger's number typed into the form
 * has not consented to anything, however the checkbox was sent.
 */
export async function phoneHasOrderedAtShop(tenantId: string, phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;
  const db = getDb();
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), sql`right(regexp_replace(coalesce(${orders.guestPhone}, ''), '\\D', '', 'g'), 10) = ${digits}`))
    .limit(1);
  return Boolean(row);
}
