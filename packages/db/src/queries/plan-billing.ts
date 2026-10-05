import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { planPayments, tenants } from "../schema/index";
import { PLAN_PERIOD_DAYS, PLAN_PRICES_PHP } from "../plans";
import { nextReceiptNumber } from "./billing";

export { PLAN_PERIOD_DAYS, PLAN_PRICES_PHP };

export interface CreatePlanPaymentInput {
  tenantId: string;
  plan: "growth" | "pro";
  amount: string;
  gatewayIntentId: string;
}

export async function createPlanPayment(input: CreatePlanPaymentInput): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(planPayments)
    .values({
      tenantId: input.tenantId,
      plan: input.plan,
      amount: input.amount,
      gatewayIntentId: input.gatewayIntentId,
      periodDays: PLAN_PERIOD_DAYS,
    })
    .returning({ id: planPayments.id });
  if (!row) throw new Error("Failed to record plan payment");
  return row.id;
}

export interface MarkPlanPaymentPaidResult {
  ok: boolean;
  /** True the first time this intent transitions to paid (false on webhook replays). */
  transitioned: boolean;
  tenantId?: string;
  plan?: string;
}

/**
 * Marks a plan payment paid and applies the upgrade to the tenant.
 * Idempotent on the gateway intent id.
 */
export async function markPlanPaymentPaidByIntent(
  gatewayIntentId: string
): Promise<MarkPlanPaymentPaidResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(planPayments)
      .where(eq(planPayments.gatewayIntentId, gatewayIntentId))
      .limit(1)
      .for("update");

    if (!payment) return { ok: false, transitioned: false };
    if (payment.status === "paid") {
      return { ok: true, transitioned: false, tenantId: payment.tenantId, plan: payment.plan };
    }

    const now = new Date();
    await tx
      .update(planPayments)
      .set({ status: "paid", paidAt: now, receiptNumber: payment.receiptNumber ?? (await nextReceiptNumber(tx, now)) })
      .where(eq(planPayments.id, payment.id));

    // Extend from the current expiry when the tenant renews early.
    const [tenant] = await tx
      .select({ planExpiresAt: tenants.planExpiresAt, subscriptionPlan: tenants.subscriptionPlan })
      .from(tenants)
      .where(eq(tenants.id, payment.tenantId))
      .limit(1);

    const base =
      tenant?.subscriptionPlan === payment.plan &&
      tenant?.planExpiresAt &&
      tenant.planExpiresAt > now
        ? tenant.planExpiresAt
        : now;
    const expiresAt = new Date(base.getTime() + payment.periodDays * 24 * 60 * 60 * 1000);

    await tx
      .update(tenants)
      .set({ subscriptionPlan: payment.plan, planExpiresAt: expiresAt, updatedAt: sql`now()` })
      .where(eq(tenants.id, payment.tenantId));

    return { ok: true, transitioned: true, tenantId: payment.tenantId, plan: payment.plan };
  });
}
