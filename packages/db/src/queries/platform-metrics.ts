import { sql } from "drizzle-orm";
import { getDb } from "../client";

/**
 * Plan §14 — the numbers that tell us whether V1 works, for the ops console.
 * One window (default 7 days, Manila-agnostic UTC timestamps) plus an 8-week
 * orders trend. Read-only; every query is bounded by the window.
 */

export interface PlatformMetrics {
  windowDays: number;
  since: string;
  activation: {
    newShops: number;
    withProduct: number;
    withLink: number;
    withOrder: number;
    medianHoursToFirstOrder: number | null;
  };
  conversion: {
    linkViews: number;
    checkoutStarts: number;
    linkOrders: number;
    medianMinutesToConfirmPayment: number | null;
    recoveryTexts: number;
    recoveredOrders: number;
  };
  fulfillment: {
    deliveryOrders: number;
    bookedInApp: number;
    delivered: number;
    failedOrReturned: number;
    medianHoursPaidToDelivered: number | null;
  };
  messaging: { sent: number; failed: number; suppressed: number; optOuts: number };
  retention: { activeShops7d: number; activeShops30d: number; buyers: number; repeatBuyers: number };
  pos: { sales: number; total: number };
  /** Phase 12: online orders placed by signed-in Guma ID buyers. */
  gumaId: { orders: number; withGumaId: number; accounts: number };
  byChannel: Array<{ channel: string; orders: number; sales: number }>;
  weekly: Array<{ week: string; checkoutLink: number; store: number; pos: number }>;
}

type Row = Record<string, unknown>;

async function one(query: ReturnType<typeof sql>): Promise<Row> {
  const rows = (await getDb().execute(query)) as unknown as Row[];
  return rows[0] ?? {};
}

async function many(query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await getDb().execute(query)) as unknown as Row[];
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const nOrNull = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

export async function getPlatformMetrics(options: { days?: number; now?: Date } = {}): Promise<PlatformMetrics> {
  const days = Math.min(Math.max(options.days ?? 7, 1), 90);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const [activation, conversion, payConfirm, recovery, fulfillment, messaging, optOuts, retention, buyers, pos, gid, byChannel, weekly] =
    await Promise.all([
      one(sql`
        with s as (select id, created_at from tenants where created_at >= ${since}::timestamptz)
        select
          (select count(*) from s) as new_shops,
          (select count(*) from s where exists (select 1 from products p where p.tenant_id = s.id)) as with_product,
          (select count(*) from s where exists (select 1 from checkout_links l where l.tenant_id = s.id)) as with_link,
          (select count(*) from s where exists (select 1 from orders o where o.tenant_id = s.id)) as with_order,
          (select percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (f.first_at - s.created_at)) / 3600))
             from s join lateral (select min(o.created_at) as first_at from orders o where o.tenant_id = s.id) f on f.first_at is not null
          ) as median_hours
      `),
      one(sql`
        select
          (select coalesce(sum(view_count), 0) from checkout_links where created_at >= ${since}::timestamptz) as link_views,
          (select count(*) from checkout_sessions where created_at >= ${since}::timestamptz and source_channel = 'checkout_link') as starts,
          (select count(*) from orders where created_at >= ${since}::timestamptz and source_channel = 'checkout_link') as link_orders
      `),
      one(sql`
        select percentile_cont(0.5) within group (order by extract(epoch from (paid_at - created_at)) / 60) as median_minutes
        from orders
        where created_at >= ${since}::timestamptz and paid_at is not null
          and coalesce(payment_method, '') not in ('cod', 'cash') and coalesce(source_channel, '') <> 'pos'
      `),
      one(sql`
        select
          (select count(*) from message_log where recipe = 'abandoned_checkout' and created_at >= ${since}::timestamptz and status = 'sent') as texts,
          (select count(*) from checkout_sessions where recovery_sent_count > 0 and converted_order_id is not null and last_recovery_at >= ${since}::timestamptz) as recovered
      `),
      one(sql`
        select
          count(*) filter (where delivery_type = 'delivery') as delivery_orders,
          count(*) filter (where delivery_type = 'delivery' and exists (select 1 from deliveries d where d.order_id = o.id)) as booked,
          count(*) filter (where delivery_type = 'delivery' and fulfillment_state::text = 'delivered') as delivered,
          count(*) filter (where delivery_type = 'delivery' and fulfillment_state::text in ('failed_delivery', 'returned')) as failed,
          percentile_cont(0.5) within group (order by extract(epoch from (completed_at - paid_at)) / 3600)
            filter (where delivery_type = 'delivery' and completed_at is not null and paid_at is not null) as median_hours
        from orders o
        where created_at >= ${since}::timestamptz and coalesce(source_channel, '') <> 'pos'
      `),
      one(sql`
        select
          count(*) filter (where status in ('sent', 'delivered')) as sent,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where status = 'suppressed') as suppressed
        from message_log where created_at >= ${since}::timestamptz and channel = 'sms'
      `),
      one(sql`select count(*) as n from messaging_opt_outs where created_at >= ${since}::timestamptz`),
      one(sql`
        select
          (select count(distinct tenant_id) from orders where created_at >= ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}::timestamptz) as active7,
          (select count(distinct tenant_id) from orders where created_at >= ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz) as active30
      `),
      one(sql`
        with b as (
          select tenant_id, right(regexp_replace(coalesce(guest_phone, ''), '\\D', '', 'g'), 10) as phone
          from orders where created_at >= ${since}::timestamptz and guest_phone is not null
          group by 1, 2
        )
        select count(*) as buyers,
          count(*) filter (where (
            select count(*) from orders o2
            where o2.tenant_id = b.tenant_id
              and right(regexp_replace(coalesce(o2.guest_phone, ''), '\\D', '', 'g'), 10) = b.phone
          ) >= 2) as repeat_buyers
        from b where length(phone) = 10
      `),
      one(sql`
        select count(*) as sales, coalesce(sum(total), 0) as total
        from orders where created_at >= ${since}::timestamptz and source_channel = 'pos'
          and coalesce(order_state::text, 'open') <> 'cancelled'
      `),
      one(sql`
        select
          (select count(*) from orders where created_at >= ${since}::timestamptz and coalesce(source_channel, '') <> 'pos') as orders,
          (select count(*) from orders where created_at >= ${since}::timestamptz and coalesce(source_channel, '') <> 'pos' and buyer_account_id is not null) as with_id,
          (select count(*) from buyer_accounts) as accounts
      `),
      many(sql`
        select coalesce(source_channel, 'storefront') as channel, count(*) as orders, coalesce(sum(total), 0) as sales
        from orders where created_at >= ${since}::timestamptz and coalesce(order_state::text, 'open') <> 'cancelled'
        group by 1 order by 2 desc
      `),
      many(sql`
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
          count(*) filter (where source_channel = 'checkout_link') as link,
          count(*) filter (where source_channel = 'pos') as pos,
          count(*) filter (where coalesce(source_channel, 'storefront') not in ('checkout_link', 'pos')) as store
        from orders
        where created_at >= ${new Date(now.getTime() - 56 * 86_400_000).toISOString()}::timestamptz
          and coalesce(order_state::text, 'open') <> 'cancelled'
        group by 1 order by 1
      `),
    ]);

  return {
    windowDays: days,
    since,
    activation: {
      newShops: n(activation.new_shops),
      withProduct: n(activation.with_product),
      withLink: n(activation.with_link),
      withOrder: n(activation.with_order),
      medianHoursToFirstOrder: nOrNull(activation.median_hours),
    },
    conversion: {
      linkViews: n(conversion.link_views),
      checkoutStarts: n(conversion.starts),
      linkOrders: n(conversion.link_orders),
      medianMinutesToConfirmPayment: nOrNull(payConfirm.median_minutes),
      recoveryTexts: n(recovery.texts),
      recoveredOrders: n(recovery.recovered),
    },
    fulfillment: {
      deliveryOrders: n(fulfillment.delivery_orders),
      bookedInApp: n(fulfillment.booked),
      delivered: n(fulfillment.delivered),
      failedOrReturned: n(fulfillment.failed),
      medianHoursPaidToDelivered: nOrNull(fulfillment.median_hours),
    },
    messaging: { sent: n(messaging.sent), failed: n(messaging.failed), suppressed: n(messaging.suppressed), optOuts: n(optOuts.n) },
    retention: {
      activeShops7d: n(retention.active7),
      activeShops30d: n(retention.active30),
      buyers: n(buyers.buyers),
      repeatBuyers: n(buyers.repeat_buyers),
    },
    pos: { sales: n(pos.sales), total: n(pos.total) },
    gumaId: { orders: n(gid.orders), withGumaId: n(gid.with_id), accounts: n(gid.accounts) },
    byChannel: byChannel.map((r) => ({ channel: String(r.channel), orders: n(r.orders), sales: n(r.sales) })),
    weekly: weekly.map((r) => ({ week: String(r.week), checkoutLink: n(r.link), store: n(r.store), pos: n(r.pos) })),
  };
}
