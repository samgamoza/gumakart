import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "../client";
import { billingNotices, planPayments, tenants, users } from "../schema/index";
import { logActivity } from "./activity";

/**
 * Phase 16 — plan billing lifecycle. Paid plans run for 30 days from payment (renewing early
 * extends). Reminders go out 7, 3 and 1 day(s) before the end; after the end there are
 * PLAN_GRACE_DAYS of grace with everything still on, then the shop moves to Free. Nothing is
 * deleted on downgrade — features above Free are simply locked until they renew.
 * Plans set by Guma Kart ops without an end date ("manual") never expire.
 */

export const PLAN_GRACE_DAYS = 7;
const DAY = 86_400_000;

export type PlanState = "free" | "manual" | "active" | "expiring" | "grace";

export interface PlanStatus {
  plan: string;
  state: PlanState;
  expiresAt: Date | null;
  daysLeft: number | null;
  graceEndsAt: Date | null;
}

export function planStatusOf(plan: string | null | undefined, expiresAt: Date | null | undefined, now = new Date()): PlanStatus {
  const p = plan && plan !== "free" ? plan : "free";
  if (p === "free") return { plan: "free", state: "free", expiresAt: null, daysLeft: null, graceEndsAt: null };
  if (!expiresAt) return { plan: p, state: "manual", expiresAt: null, daysLeft: null, graceEndsAt: null };
  const ms = expiresAt.getTime() - now.getTime();
  const graceEndsAt = new Date(expiresAt.getTime() + PLAN_GRACE_DAYS * DAY);
  if (ms <= 0) return { plan: p, state: "grace", expiresAt, daysLeft: Math.max(0, Math.ceil((graceEndsAt.getTime() - now.getTime()) / DAY)), graceEndsAt };
  const daysLeft = Math.ceil(ms / DAY);
  return { plan: p, state: daysLeft <= 7 ? "expiring" : "active", expiresAt, daysLeft, graceEndsAt };
}

export type NoticeKind = "reminder_7" | "reminder_3" | "reminder_1" | "expired" | "downgraded";

/** Which notice is due now for a shop (the most urgent one only). */
export function dueNoticeKind(expiresAt: Date, now: Date): NoticeKind | null {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= -PLAN_GRACE_DAYS * DAY) return "downgraded";
  if (ms <= 0) return "expired";
  if (ms <= DAY) return "reminder_1";
  if (ms <= 3 * DAY) return "reminder_3";
  if (ms <= 7 * DAY) return "reminder_7";
  return null;
}

export interface BillingNoticeToSend {
  id: string;
  tenantId: string;
  shopName: string;
  shopSlug: string;
  kind: NoticeKind;
  plan: string;
  periodEnd: Date;
  ownerEmail: string | null;
}

/**
 * Hourly: records each due notice once per billing period and downgrades shops whose grace
 * ended. Returns the notices created this run so the caller can email the owners.
 */
export async function runPlanLifecycle(now = new Date()): Promise<{ notices: BillingNoticeToSend[]; downgraded: number }> {
  const db = getDb();
  const rows = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, plan: tenants.subscriptionPlan, expiresAt: tenants.planExpiresAt })
    .from(tenants)
    .where(and(isNotNull(tenants.planExpiresAt), ne(tenants.subscriptionPlan, "free"), sql`${tenants.planExpiresAt} <= ${new Date(now.getTime() + 7 * DAY).toISOString()}::timestamptz`));
  const notices: BillingNoticeToSend[] = [];
  let downgraded = 0;
  for (const t of rows) {
    if (!t.expiresAt || !t.plan) continue;
    const kind = dueNoticeKind(t.expiresAt, now);
    if (!kind) continue;
    const created = await db.transaction(async (tx) => {
      const [notice] = await tx
        .insert(billingNotices)
        .values({ tenantId: t.id, kind, periodEnd: t.expiresAt!, plan: t.plan! })
        .onConflictDoNothing()
        .returning({ id: billingNotices.id });
      if (kind === "downgraded") {
        // Guard on the same expiry, so a renewal that landed meanwhile is never undone.
        const done = await tx
          .update(tenants)
          .set({ subscriptionPlan: "free", planExpiresAt: null, updatedAt: sql`now()` })
          .where(and(eq(tenants.id, t.id), eq(tenants.planExpiresAt, t.expiresAt!)))
          .returning({ id: tenants.id });
        if (done.length) downgraded += 1;
      }
      return notice ?? null;
    });
    if (kind === "downgraded" && created) {
      await logActivity(t.id, { userId: null, name: "Guma Kart billing", role: "system" }, {
        action: "plan.downgraded",
        entityType: "plan",
        summary: `Plan moved from ${t.plan} to Free — it ended ${t.expiresAt.toISOString().slice(0, 10)} and wasn't renewed within ${PLAN_GRACE_DAYS} days`,
      });
    }
    if (created) {
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, t.id), eq(users.role, "seller_owner")))
        .limit(1);
      notices.push({ id: created.id, tenantId: t.id, shopName: t.name, shopSlug: t.slug, kind, plan: t.plan, periodEnd: t.expiresAt, ownerEmail: owner?.email ?? null });
    }
  }
  return { notices, downgraded };
}

export async function markNoticeEmailed(id: string): Promise<void> {
  await getDb().update(billingNotices).set({ emailSent: true }).where(eq(billingNotices.id, id));
}

export interface BillingPaymentRow {
  id: string;
  plan: string;
  amount: string;
  status: string;
  periodDays: number;
  receiptNumber: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export async function getBillingOverview(tenantId: string, now = new Date()): Promise<{ status: PlanStatus; payments: BillingPaymentRow[] }> {
  const db = getDb();
  const [t] = await db.select({ plan: tenants.subscriptionPlan, expiresAt: tenants.planExpiresAt }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const payments = await db
    .select({
      id: planPayments.id,
      plan: planPayments.plan,
      amount: planPayments.amount,
      status: planPayments.status,
      periodDays: planPayments.periodDays,
      receiptNumber: planPayments.receiptNumber,
      createdAt: planPayments.createdAt,
      paidAt: planPayments.paidAt,
    })
    .from(planPayments)
    .where(eq(planPayments.tenantId, tenantId))
    .orderBy(desc(planPayments.createdAt))
    .limit(24);
  return { status: planStatusOf(t?.plan, t?.expiresAt, now), payments: payments.map((p) => ({ ...p, status: String(p.status) })) };
}

export interface PlanReceipt extends BillingPaymentRow {
  shopName: string;
  legalName: string | null;
  shopSlug: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export async function getPlanReceipt(tenantId: string, paymentId: string): Promise<PlanReceipt | null> {
  const [row] = await getDb()
    .select({ p: planPayments, shopName: tenants.name, legalName: tenants.legalName, slug: tenants.slug })
    .from(planPayments)
    .innerJoin(tenants, eq(tenants.id, planPayments.tenantId))
    .where(and(eq(planPayments.tenantId, tenantId), eq(planPayments.id, paymentId), eq(planPayments.status, "paid")))
    .limit(1);
  if (!row) return null;
  const start = row.p.paidAt;
  return {
    id: row.p.id,
    plan: row.p.plan,
    amount: row.p.amount,
    status: String(row.p.status),
    periodDays: row.p.periodDays,
    receiptNumber: row.p.receiptNumber,
    createdAt: row.p.createdAt,
    paidAt: row.p.paidAt,
    shopName: row.shopName,
    legalName: row.legalName,
    shopSlug: row.slug,
    periodStart: start,
    periodEnd: start ? new Date(start.getTime() + row.p.periodDays * DAY) : null,
  };
}

/** GK-2026-000123 — called inside the "mark paid" transaction. */
export async function nextReceiptNumber(tx: { execute: ReturnType<typeof getDb>["execute"] }, now = new Date()): Promise<string> {
  const rows = (await tx.execute(sql`select nextval('plan_receipt_seq')::bigint as n`)) as unknown as Array<{ n: string | number }>;
  return `GK-${now.getUTCFullYear()}-${String(rows[0]!.n).padStart(6, "0")}`;
}
