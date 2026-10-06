import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { customers, orders, referrals, tenants } from "../schema/index";
import { newReferralCode, normalizeReferralCode, referralRules, type ReferralRules, type TenantLoyaltySettings } from "../types/loyalty";
import { issueGiftCardInTx } from "./gift-cards";

/**
 * Phase 32: buyer referrals (palenkeAi harvest H8). A buyer shares their shop link with ?ref=suki&code=CODE;
 * the friend's order carries the code; when that friend's FIRST order at the shop is paid (COD:
 * delivered) and big enough, both get store credit. Each friend can be referred once (unique row),
 * self-referrals and same-phone pairs are blocked, and a referrer earns at most N rewards a month.
 */

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const EARN_AMOUNT = sql`greatest(0, o.total - coalesce(o.delivery_fee, 0) - coalesce(o.gift_card_amount, 0) - coalesce(o.refunded_amount, 0))`;
const PAID = sql`(o.payment_state = 'paid' or o.payment_state = 'partially_refunded' or (o.payment_state = 'cod_due' and o.fulfillment_state = 'delivered'))`;
const LIVE = sql`coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null`;

export async function getReferralRules(tenantId: string): Promise<ReferralRules> {
  const [t] = await getDb().select({ s: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return referralRules((t?.s as { loyalty?: TenantLoyaltySettings } | null)?.loyalty);
}

/** This buyer's code at this shop, made the first time it's needed. */
export async function ensureReferralCode(tenantId: string, customerId: string): Promise<string> {
  const db = getDb();
  const [c] = await db.select({ code: customers.referralCode }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
  if (!c) throw new Error("Customer not found.");
  if (c.code) return c.code;
  for (let i = 0; i < 6; i++) {
    const code = newReferralCode();
    try {
      const [u] = await db
        .update(customers)
        .set({ referralCode: code })
        .where(and(eq(customers.id, customerId), sql`${customers.referralCode} is null`))
        .returning({ code: customers.referralCode });
      if (u?.code) return u.code;
      const [again] = await db.select({ code: customers.referralCode }).from(customers).where(eq(customers.id, customerId)).limit(1);
      if (again?.code) return again.code;
    } catch {
      /* code taken in this shop — try another */
    }
  }
  throw new Error("Could not make a referral code.");
}

/** At checkout: keep the code on the order if it's a real code of ANOTHER buyer at this shop. */
export async function attachReferralCode(tenantId: string, orderId: string, rawCode: string | null | undefined): Promise<boolean> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return false;
  const rules = await getReferralRules(tenantId);
  if (!rules.enabled) return false;
  const [ok] = await rows<{ ok: boolean }>(sql`
    select true as ok from customers r join orders o on o.id = ${orderId}
    where r.tenant_id = ${tenantId} and r.referral_code = ${code} and o.tenant_id = ${tenantId}
      and (o.customer_record_id is null or o.customer_record_id <> r.id)`);
  if (!ok) return false;
  await getDb().update(orders).set({ referralCode: code }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
  return true;
}

const lastDigits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** Rewards (or blocks) referred first orders. Idempotent; run from the loyalty cron. */
export async function syncReferrals(opts: { tenantId?: string; limit?: number; now?: Date } = {}): Promise<{ rewarded: number; blocked: number }> {
  const shops = await rows<{ id: string; s: { loyalty?: TenantLoyaltySettings } | null }>(sql`
    select id, settings_json as s from tenants
    where (settings_json -> 'loyalty' -> 'referral' ->> 'enabled') = 'true' ${opts.tenantId ? sql`and id = ${opts.tenantId}` : sql``}`);
  let rewarded = 0;
  let blocked = 0;
  for (const shop of shops) {
    const rules = referralRules(shop.s?.loyalty);
    if (!rules.enabled) continue;
    const pending = await rows<{ order_id: string; friend_id: string; friend_phone: string; friend_name: string | null; amount: string; created_at: string; referrer_id: string | null; referrer_phone: string | null; referrer_name: string | null }>(sql`
      select o.id as order_id, o.customer_record_id as friend_id, f.phone as friend_phone, f.name as friend_name,
             ${EARN_AMOUNT} as amount, o.created_at::text as created_at,
             r.id as referrer_id, r.phone as referrer_phone, r.name as referrer_name
      from orders o
      join customers f on f.id = o.customer_record_id
      left join customers r on r.tenant_id = o.tenant_id and r.referral_code = o.referral_code
      where o.tenant_id = ${shop.id} and o.referral_code is not null and ${LIVE} and ${PAID}
        and not exists (select 1 from referrals x where x.tenant_id = o.tenant_id and x.friend_customer_id = o.customer_record_id)
      order by o.created_at
      limit ${opts.limit ?? 200}`);
    for (const p of pending) {
      const block = async (reason: string) => {
        const ins = await getDb()
          .insert(referrals)
          .values({ tenantId: shop.id, referrerCustomerId: p.referrer_id ?? p.friend_id, friendCustomerId: p.friend_id, orderId: p.order_id, status: "blocked", reason })
          .onConflictDoNothing()
          .returning({ id: referrals.id });
        if (ins.length) blocked++;
      };
      if (!p.referrer_id) {
        await block("Code no longer valid");
        continue;
      }
      if (p.referrer_id === p.friend_id || lastDigits(p.referrer_phone) === lastDigits(p.friend_phone)) {
        await block("Same buyer");
        continue;
      }
      const [earlier] = await rows<{ n: string }>(sql`
        select count(*) as n from orders o
        where o.tenant_id = ${shop.id} and o.customer_record_id = ${p.friend_id} and ${LIVE} and ${PAID}
          and o.created_at < ${p.created_at}::timestamptz`);
      if (num(earlier?.n) > 0) {
        await block("Not their first order");
        continue;
      }
      if (num(p.amount) < rules.minOrder) {
        await block(`First order under ₱${rules.minOrder}`);
        continue;
      }
      const [referrerPaid] = await rows<{ n: string }>(sql`
        select count(*) as n from orders o where o.tenant_id = ${shop.id} and o.customer_record_id = ${p.referrer_id} and ${LIVE} and ${PAID}`);
      if (num(referrerPaid?.n) === 0) {
        await block("Referrer has no paid order yet");
        continue;
      }
      const month = new Date(opts.now ?? Date.now()).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).slice(0, 7);
      const [thisMonth] = await rows<{ n: string }>(sql`
        select count(*) as n from referrals where tenant_id = ${shop.id} and referrer_customer_id = ${p.referrer_id} and status = 'rewarded'
          and to_char(created_at at time zone 'Asia/Manila', 'YYYY-MM') = ${month}`);
      if (num(thisMonth?.n) >= rules.monthlyCap) {
        await block("Referrer reached this month's limit");
        continue;
      }
      await getDb().transaction(async (tx) => {
        const [row] = await tx
          .insert(referrals)
          .values({ tenantId: shop.id, referrerCustomerId: p.referrer_id!, friendCustomerId: p.friend_id, orderId: p.order_id, status: "rewarded" })
          .onConflictDoNothing()
          .returning({ id: referrals.id });
        if (!row) return; // another run got here first
        const note = (who: string) => `Suki referral: ${who}`;
        const refCard =
          rules.referrerReward > 0
            ? await issueGiftCardInTx(tx, { tenantId: shop.id, amount: rules.referrerReward, kind: "store_credit", customerId: p.referrer_id!, recipientName: p.referrer_name, note: note(`invited ${p.friend_name ?? "a friend"}`), createdByName: "Suki referrals", orderId: p.order_id })
            : null;
        const friendCard =
          rules.friendReward > 0
            ? await issueGiftCardInTx(tx, { tenantId: shop.id, amount: rules.friendReward, kind: "store_credit", customerId: p.friend_id, recipientName: p.friend_name, note: note("welcome"), createdByName: "Suki referrals", orderId: p.order_id })
            : null;
        await tx.update(referrals).set({ referrerCardId: refCard?.id ?? null, friendCardId: friendCard?.id ?? null }).where(eq(referrals.id, row.id));
        rewarded++;
      });
    }
  }
  return { rewarded, blocked };
}

export interface ReferralSummary {
  rules: ReferralRules;
  rewarded30d: number;
  blocked30d: number;
  creditIssued30d: number;
  topReferrers: Array<{ name: string | null; phone: string; count: number }>;
}

export async function getReferralSummary(tenantId: string): Promise<ReferralSummary> {
  const rules = await getReferralRules(tenantId);
  const [[s], top] = await Promise.all([
    rows<{ rewarded: string; blocked: string }>(sql`
      select count(*) filter (where status = 'rewarded') as rewarded, count(*) filter (where status = 'blocked') as blocked
      from referrals where tenant_id = ${tenantId} and created_at >= now() - interval '30 days'`),
    rows<{ name: string | null; phone: string; n: string }>(sql`
      select c.name, c.phone, count(*) as n from referrals r join customers c on c.id = r.referrer_customer_id
      where r.tenant_id = ${tenantId} and r.status = 'rewarded' group by c.id, c.name, c.phone order by n desc limit 5`),
  ]);
  const rewarded30d = num(s?.rewarded);
  return {
    rules,
    rewarded30d,
    blocked30d: num(s?.blocked),
    creditIssued30d: rewarded30d * (rules.referrerReward + rules.friendReward),
    topReferrers: top.map((t) => ({ name: t.name, phone: t.phone, count: num(t.n) })),
  };
}

/** Saves referral rules inside the loyalty settings. */
export async function saveReferralSettings(tenantId: string, input: TenantLoyaltySettings["referral"]): Promise<ReferralRules> {
  const db = getDb();
  const [t] = await db.select({ s: tenants.settingsJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const current = (t?.s ?? {}) as Record<string, unknown> & { loyalty?: TenantLoyaltySettings };
  const referral = referralRules({ referral: { ...current.loyalty?.referral, ...input } });
  await db
    .update(tenants)
    .set({ settingsJson: { ...current, loyalty: { ...current.loyalty, referral } } as never, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  return referral;
}
