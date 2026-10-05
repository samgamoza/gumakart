import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../client";
import { activityLog } from "../schema/index";

/**
 * Phase 10 — shop activity log: who confirmed a payment, refunded, changed a price or
 * stock, closed a shift, invited or removed staff. Append-only; written after the
 * action succeeds. Failures to log never fail the action (logged to the console).
 */

export interface ActivityActor {
  userId: string | null;
  name: string;
  role: string | null;
}

export interface ActivityInput {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown> | null;
}

export async function logActivity(tenantId: string, actor: ActivityActor, input: ActivityInput): Promise<void> {
  try {
    await getDb()
      .insert(activityLog)
      .values({
        tenantId,
        actorUserId: actor.userId,
        actorName: (actor.name || "Someone").slice(0, 80),
        actorRole: actor.role?.slice(0, 16) ?? null,
        action: input.action.slice(0, 48),
        entityType: input.entityType?.slice(0, 24) ?? null,
        entityId: input.entityId?.slice(0, 64) ?? null,
        summary: input.summary.slice(0, 300),
        metaJson: input.meta ?? null,
      });
  } catch (error) {
    console.error("[activity] could not log", input.action, error);
  }
}

export interface ActivityRow {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  createdAt: Date;
}

/** Newest first, 50 per page; `before` = createdAt of the last row seen. */
export async function listActivity(
  tenantId: string,
  options: { actorUserId?: string | null; actionPrefix?: string | null; before?: Date | null; limit?: number } = {}
): Promise<ActivityRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await getDb()
    .select({
      id: activityLog.id,
      actorUserId: activityLog.actorUserId,
      actorName: activityLog.actorName,
      actorRole: activityLog.actorRole,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.tenantId, tenantId),
        options.actorUserId ? eq(activityLog.actorUserId, options.actorUserId) : undefined,
        options.before ? lt(activityLog.createdAt, options.before) : undefined
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(options.actionPrefix ? limit * 4 : limit);
  return options.actionPrefix ? rows.filter((r) => r.action.startsWith(options.actionPrefix!)).slice(0, limit) : rows;
}

/** "TES-0012" for activity summaries (null if not this shop's order). */
export async function orderNumberFor(tenantId: string, orderId: string): Promise<string | null> {
  const { orders } = await import("../schema/index");
  const [row] = await getDb()
    .select({ n: orders.orderNumber })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);
  return row?.n ?? null;
}

/** Before/after view of a product for "changed price ₱300 → ₱350" style summaries. */
export async function productSnapshot(
  tenantId: string,
  productId: string
): Promise<{ title: string; price: number; status: string; stock: number; hasOptions: boolean } | null> {
  const { products, productVariants } = await import("../schema/index");
  const { asc, sql } = await import("drizzle-orm");
  const [row] = await getDb()
    .select({
      title: products.title,
      price: products.basePrice,
      status: products.status,
      options: products.optionsJson,
      stock: sql<number>`(select coalesce(sum(${productVariants.stockQty}), 0)::int from ${productVariants} where ${productVariants.productId} = ${products.id} and ${productVariants.active})`,
    })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .orderBy(asc(products.id))
    .limit(1);
  if (!row) return null;
  return { title: row.title, price: Number(row.price), status: row.status, stock: Number(row.stock), hasOptions: (row.options?.length ?? 0) > 0 };
}
