import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { customers, loyaltyLedger, tenants } from "../schema/index";
import {
  creditFor,
  loyaltyRules,
  nextTier,
  pointsFor,
  tierFor,
  type LoyaltyRules,
  type SukiTier,
  type TenantLoyaltySettings,
} from "../types/loyalty";
import { issueGiftCardInTx } from "./gift-cards";

/**
 * Phase 27: Suki loyalty points.
 *
 * Earning is a sweep (cron, and right after a payment is confirmed): every paid order of a shop
 * with loyalty on gets one "earn" row; if the order is later cancelled or refunded, a "reverse" row
 * is kept equal to the change, so the balance always matches what was really paid. Both rows are
 * unique per order, so running the sweep twice never double-counts.
 */

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v));

/** What a paid order earns on: items after discount, minus delivery, gift-card/store-credit payment and refunds. */
const EARN_AMOUNT = sql`greatest(0, o.total - coalesce(o.delivery_fee, 0) - coalesce(o.gift_card_amount, 0) - coalesce(o.refunded_amount, 0))`;
const PAID = sql`(o.payment_state = 'paid' or o.payment_state = 'partially_refunded' or (o.payment_state = 'cod_due' and o.fulfillment_state = 'delivered'))`;
const LIVE = sql`coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null`;

export class LoyaltyError extends Error {
  constructor(
    public code: "OFF" | "NOT_FOUND" | "TOO_FEW" | "NOT_ENOUGH" | "INVALID",
    message: string
  ) {
    super(message);
    this.name = "LoyaltyError";
  }
}

export async function getLoyaltyRules(tenantId: string): Promise<LoyaltyRules> {
  const [t] = await getDb().select({ s: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return loyaltyRules((t?.s as { loyalty?: TenantLoyaltySettings } | null)?.loyalty);
}

/** Saves the shop's rules. Turning it on stamps enabledAt (only later orders earn). */
export async function saveLoyaltySettings(tenantId: string, input: TenantLoyaltySettings): Promise<LoyaltyRules> {
  const db = getDb();
  const [t] = await db.select({ s: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw new LoyaltyError("NOT_FOUND", "Shop not found.");
  const current = (t.s ?? {}) as Record<string, unknown> & { loyalty?: TenantLoyaltySettings };
  const before = loyaltyRules(current.loyalty);
  const merged = loyaltyRules({ ...current.loyalty, ...input, tiers: { ...current.loyalty?.tiers, ...input.tiers } });
  const enabledAt = merged.enabled ? (before.enabled && before.enabledAt ? before.enabledAt : new Date().toISOString()) : before.enabledAt;
  const loyalty: TenantLoyaltySettings = { ...merged, enabledAt: enabledAt ?? undefined };
  await db.update(tenants).set({ settingsJson: { ...current, loyalty } as never, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return loyaltyRules(loyalty);
}

/** 12-month spend at this shop that counts for tiers (paid, not cancelled), before `at`, excluding one order. */
async function spend12m(tenantId: string, customerId: string, at: Date, excludeOrderId?: string): Promise<number> {
  const [r] = await rows<{ s: string }>(sql`
    select coalesce(sum(${EARN_AMOUNT}), 0) as s from orders o
    where o.tenant_id = ${tenantId} and o.customer_record_id = ${customerId} and ${LIVE} and ${PAID}
      and o.created_at < ${at.toISOString()}::timestamptz and o.created_at >= ${new Date(at.getTime() - 365 * 86_400_000).toISOString()}::timestamptz
      ${excludeOrderId ? sql`and o.id <> ${excludeOrderId}` : sql``}`);
  return num(r?.s);
}

/**
 * Earn + reverse for one shop (or every shop with loyalty on). Returns how many rows changed.
 * Idempotent: safe to run every few minutes and after each payment confirmation.
 */
export async function syncLoyaltyPoints(opts: { tenantId?: string; limit?: number } = {}): Promise<{ earned: number; reversed: number }> {
  const limit = opts.limit ?? 500;
  const shops = await rows<{ id: string; s: { loyalty?: TenantLoyaltySettings } | null }>(sql`
    select id, settings_json as s from tenants
    where (settings_json -> 'loyalty' ->> 'enabled') = 'true' ${opts.tenantId ? sql`and id = ${opts.tenantId}` : sql``}`);
  let earned = 0;
  let reversed = 0;
  for (const shop of shops) {
    const rules = loyaltyRules(shop.s?.loyalty);
    if (!rules.enabled || !rules.enabledAt) continue;

    // 1. New earnings: paid, live orders since loyalty was turned on, with a customer, not yet earned.
    const pending = await rows<{ id: string; customer_id: string; created_at: string; amount: string }>(sql`
      select o.id, o.customer_record_id as customer_id, o.created_at::text as created_at, ${EARN_AMOUNT} as amount
      from orders o
      where o.tenant_id = ${shop.id} and o.customer_record_id is not null and ${LIVE} and ${PAID}
        and o.created_at >= ${rules.enabledAt}::timestamptz
        and not exists (select 1 from loyalty_ledger l where l.order_id = o.id and l.kind = 'earn')
      order by o.created_at
      limit ${limit}`);
    for (const o of pending) {
      const amount = num(o.amount);
      const tier = tierFor(await spend12m(shop.id, o.customer_id, new Date(o.created_at), o.id), rules);
      const points = pointsFor(amount, tier, rules);
      const inserted = await getDb()
        .insert(loyaltyLedger)
        .values({ tenantId: shop.id, customerId: o.customer_id, orderId: o.id, kind: "earn", points, tier, earnAmount: amount.toFixed(2) })
        .onConflictDoNothing()
        .returning({ id: loyaltyLedger.id });
      if (inserted.length) earned++;
    }

    // 2. Keep reversals current: an earned order that's now cancelled, voided or (partly) refunded.
    const changed = await rows<{ order_id: string; customer_id: string; tier: SukiTier; earned: number; reversed: number | null; amount_now: string; live: boolean }>(sql`
      select e.order_id, e.customer_id, e.tier, e.points as earned, r.points as reversed,
             case when ${LIVE} then ${EARN_AMOUNT} else 0 end as amount_now,
             (${LIVE}) as live
      from loyalty_ledger e
      join orders o on o.id = e.order_id
      left join loyalty_ledger r on r.order_id = e.order_id and r.kind = 'reverse'
      where e.tenant_id = ${shop.id} and e.kind = 'earn'
        and (not (${LIVE}) or coalesce(o.refunded_amount, 0) > 0 or r.id is not null)`);
    for (const c of changed) {
      const target = pointsFor(num(c.amount_now), (c.tier ?? "bronze") as SukiTier, rules);
      const delta = Math.min(0, target - c.earned);
      if ((c.reversed ?? 0) === delta) continue;
      await getDb()
        .insert(loyaltyLedger)
        .values({ tenantId: shop.id, customerId: c.customer_id, orderId: c.order_id, kind: "reverse", points: delta, note: c.live ? "Refund" : "Order cancelled" })
        .onConflictDoUpdate({
          target: [loyaltyLedger.orderId, loyaltyLedger.kind],
          targetWhere: sql`order_id is not null and kind in ('earn', 'reverse')`,
          set: { points: delta, updatedAt: new Date() },
        });
      reversed++;
    }
  }
  return { earned, reversed };
}

export interface CustomerLoyalty {
  enabled: boolean;
  points: number;
  tier: SukiTier;
  spend12m: number;
  next: { tier: SukiTier; needed: number } | null;
  creditValue: number;
  canRedeem: boolean;
  rules: LoyaltyRules;
}

export async function getCustomerLoyalty(tenantId: string, customerId: string): Promise<CustomerLoyalty> {
  const rules = await getLoyaltyRules(tenantId);
  const [[b], spend] = await Promise.all([
    rows<{ p: string }>(sql`select coalesce(sum(points), 0) as p from loyalty_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}`),
    spend12m(tenantId, customerId, new Date(Date.now() + 1000)),
  ]);
  const points = num(b?.p);
  return {
    enabled: rules.enabled,
    points,
    tier: tierFor(spend, rules),
    spend12m: spend,
    next: nextTier(spend, rules),
    creditValue: creditFor(Math.max(0, points), rules),
    canRedeem: rules.enabled && points >= rules.minRedeem,
    rules,
  };
}

/** Converts points to a store-credit card for the customer. Locks the customer row so two clicks can't spend twice. */
export async function redeemLoyaltyPoints(input: { tenantId: string; customerId: string; points?: number; actorName: string }) {
  const rules = await getLoyaltyRules(input.tenantId);
  if (!rules.enabled) throw new LoyaltyError("OFF", "Suki points are turned off for this shop.");
  return getDb().transaction(async (tx) => {
    const [c] = await tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, input.tenantId)))
      .for("update")
      .limit(1);
    if (!c) throw new LoyaltyError("NOT_FOUND", "Customer not found.");
    const [b] = (await tx.execute(sql`select coalesce(sum(points), 0) as p from loyalty_ledger where tenant_id = ${input.tenantId} and customer_id = ${input.customerId}`)) as unknown as Array<{ p: string }>;
    const balance = num(b?.p);
    const points = input.points == null ? balance : Math.floor(input.points);
    if (!(points > 0)) throw new LoyaltyError("INVALID", "Enter how many points to convert.");
    if (points < rules.minRedeem) throw new LoyaltyError("TOO_FEW", `Convert at least ${rules.minRedeem} points at a time.`);
    if (points > balance) throw new LoyaltyError("NOT_ENOUGH", `Only ${Math.max(0, balance)} points available.`);
    const amount = creditFor(points, rules);
    const card = await issueGiftCardInTx(tx, {
      tenantId: input.tenantId,
      amount,
      kind: "store_credit",
      customerId: c.id,
      recipientName: c.name,
      note: `Suki points: ${points}`,
      createdByName: input.actorName,
    });
    await tx.insert(loyaltyLedger).values({
      tenantId: input.tenantId,
      customerId: c.id,
      kind: "redeem",
      points: -points,
      giftCardId: card.id,
      note: `₱${amount.toFixed(2)} store credit`,
      actorName: input.actorName.slice(0, 80),
    });
    return { points, amount, card, balance: balance - points };
  });
}

export interface LoyaltySummary {
  rules: LoyaltyRules;
  members: Record<SukiTier, number>;
  pointsOutstanding: number;
  creditOutstanding: number;
  redeemed30d: number;
}

/** For Settings → Suki loyalty: members per tier (12-month spend), points not yet used. */
export async function getLoyaltySummary(tenantId: string): Promise<LoyaltySummary> {
  const rules = await getLoyaltyRules(tenantId);
  const [spends, [p], [r]] = await Promise.all([
    rows<{ s: string }>(sql`
      select coalesce(sum(${EARN_AMOUNT}), 0) as s from orders o
      where o.tenant_id = ${tenantId} and o.customer_record_id is not null and ${LIVE} and ${PAID}
        and o.created_at >= now() - interval '365 days'
      group by o.customer_record_id`),
    rows<{ p: string }>(sql`select coalesce(sum(points), 0) as p from loyalty_ledger where tenant_id = ${tenantId}`),
    rows<{ r: string }>(sql`select coalesce(-sum(points), 0) as r from loyalty_ledger where tenant_id = ${tenantId} and kind = 'redeem' and created_at >= now() - interval '30 days'`),
  ]);
  const members: Record<SukiTier, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  for (const s of spends) members[tierFor(num(s.s), rules)]++;
  const pointsOutstanding = Math.max(0, num(p?.p));
  return { rules, members, pointsOutstanding, creditOutstanding: creditFor(pointsOutstanding, rules), redeemed30d: num(r?.r) };
}

/** Buyer order page: what this order earned (or will, once paid) and the buyer's standing at the shop. */
export async function getOrderLoyalty(orderId: string): Promise<null | {
  shopName: string;
  earned: number;
  pending: number;
  balance: number;
  tier: SukiTier;
  next: { tier: SukiTier; needed: number } | null;
  creditValue: number;
  minRedeem: number;
}> {
  const [o] = await rows<{ tenant_id: string; customer_id: string | null; name: string; amount: string; live: boolean; paid: boolean }>(sql`
    select o.tenant_id, o.customer_record_id as customer_id, t.name, ${EARN_AMOUNT} as amount, (${LIVE}) as live, (${PAID}) as paid
    from orders o join tenants t on t.id = o.tenant_id where o.id = ${orderId}`);
  if (!o?.customer_id) return null;
  const standing = await getCustomerLoyalty(o.tenant_id, o.customer_id);
  if (!standing.enabled) return null;
  const [e] = await rows<{ p: string }>(sql`select coalesce(sum(points), 0) as p from loyalty_ledger where order_id = ${orderId} and kind in ('earn', 'reverse')`);
  const earned = num(e?.p);
  const pending = !o.paid && o.live && earned === 0 ? pointsFor(num(o.amount), standing.tier, standing.rules) : 0;
  return {
    shopName: o.name,
    earned,
    pending,
    balance: Math.max(0, standing.points),
    tier: standing.tier,
    next: standing.next,
    creditValue: standing.creditValue,
    minRedeem: standing.rules.minRedeem,
  };
}
