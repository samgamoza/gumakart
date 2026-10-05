import { sql } from "drizzle-orm";
import { getDb } from "../client";

/**
 * Phase 14 — reports. Plain SQL aggregates over orders, scoped to one shop and a date range
 * in Manila time. A sale counts when it isn't cancelled or voided; its value is the total
 * minus anything refunded. Profit uses the cost snapshot taken when each line was sold
 * (order_items.unit_cost); lines without a cost are left out of profit and reported as
 * "cost coverage" so the number is never silently wrong.
 */

export interface ReportRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

const TZ = "Asia/Manila";
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Orders that count as sales, as a SQL condition on alias o. */
const COUNTED = sql`coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null`;

export interface ReportKpis {
  sales: number;
  orders: number;
  aov: number;
  itemsSold: number;
  discounts: number;
  refunds: number;
  deliveryFees: number;
  /** Gross profit on lines with a cost price; null when no line had one. */
  profit: number | null;
  /** Share (0–1) of units sold that had a cost price. */
  costCoverage: number;
  newCustomers: number;
  returningCustomers: number;
}

export interface SalesReport {
  range: { from: string; to: string };
  kpis: ReportKpis;
  previous: Pick<ReportKpis, "sales" | "orders" | "aov">;
  daily: Array<{ date: string; sales: number; orders: number }>;
  channels: Array<{ channel: string; orders: number; sales: number }>;
  payments: Array<{ method: string; orders: number; sales: number }>;
  products: Array<{ productId: string | null; title: string; qty: number; sales: number; profit: number | null }>;
  customers: Array<{ customerId: string; name: string | null; phone: string; orders: number; sales: number; lastOrderAt: string }>;
}

async function kpis(tenantId: string, range: ReportRange): Promise<ReportKpis> {
  const [o] = await rows<{ sales: string; orders: string; discounts: string; refunds: string; delivery: string }>(sql`
    select coalesce(sum(o.total - coalesce(o.refunded_amount, 0)), 0) as sales,
           count(*) as orders,
           coalesce(sum(o.discount), 0) as discounts,
           coalesce(sum(o.refunded_amount), 0) as refunds,
           coalesce(sum(o.delivery_fee), 0) as delivery
    from orders o
    where o.tenant_id = ${tenantId} and o.created_at >= ${range.from.toISOString()}::timestamptz
      and o.created_at < ${range.to.toISOString()}::timestamptz and ${COUNTED}`);
  const [i] = await rows<{ units: string; costed_units: string; profit: string | null }>(sql`
    select coalesce(sum(i.quantity - i.returned_qty), 0) as units,
           coalesce(sum(i.quantity - i.returned_qty) filter (where i.unit_cost is not null), 0) as costed_units,
           sum((i.unit_price - i.unit_cost) * (i.quantity - i.returned_qty)) filter (where i.unit_cost is not null) as profit
    from order_items i join orders o on o.id = i.order_id
    where o.tenant_id = ${tenantId} and o.created_at >= ${range.from.toISOString()}::timestamptz
      and o.created_at < ${range.to.toISOString()}::timestamptz and ${COUNTED}`);
  const [c] = await rows<{ new_c: string; returning_c: string }>(sql`
    select count(distinct o.customer_record_id) filter (where c.first_order_at >= ${range.from.toISOString()}::timestamptz) as new_c,
           count(distinct o.customer_record_id) filter (where c.first_order_at < ${range.from.toISOString()}::timestamptz) as returning_c
    from orders o join customers c on c.id = o.customer_record_id
    where o.tenant_id = ${tenantId} and o.created_at >= ${range.from.toISOString()}::timestamptz
      and o.created_at < ${range.to.toISOString()}::timestamptz and ${COUNTED}`);
  const sales = r2(num(o?.sales));
  const orders = num(o?.orders);
  const units = num(i?.units);
  return {
    sales,
    orders,
    aov: orders ? r2(sales / orders) : 0,
    itemsSold: units,
    discounts: r2(num(o?.discounts)),
    refunds: r2(num(o?.refunds)),
    deliveryFees: r2(num(o?.delivery)),
    profit: i?.profit == null ? null : r2(num(i.profit)),
    costCoverage: units ? Math.round((num(i?.costed_units) / units) * 1000) / 1000 : 0,
    newCustomers: num(c?.new_c),
    returningCustomers: num(c?.returning_c),
  };
}

export async function getSalesReport(tenantId: string, range: ReportRange): Promise<SalesReport> {
  const span = range.to.getTime() - range.from.getTime();
  const prevRange = { from: new Date(range.from.getTime() - span), to: range.from };
  const where = sql`o.tenant_id = ${tenantId} and o.created_at >= ${range.from.toISOString()}::timestamptz
      and o.created_at < ${range.to.toISOString()}::timestamptz and ${COUNTED}`;

  const [current, previous, daily, channels, payments, products, customers] = await Promise.all([
    kpis(tenantId, range),
    kpis(tenantId, prevRange),
    rows<{ d: string; sales: string; orders: string }>(sql`
      select to_char(o.created_at at time zone ${TZ}, 'YYYY-MM-DD') as d,
             sum(o.total - coalesce(o.refunded_amount, 0)) as sales, count(*) as orders
      from orders o where ${where} group by 1 order by 1`),
    rows<{ channel: string; orders: string; sales: string }>(sql`
      select coalesce(o.sales_channel, case when o.source_channel = 'pos' then 'pos' else 'direct' end) as channel,
             count(*) as orders, sum(o.total - coalesce(o.refunded_amount, 0)) as sales
      from orders o where ${where} group by 1 order by 3 desc`),
    rows<{ method: string; orders: string; sales: string }>(sql`
      select coalesce(nullif(o.payment_method, ''), 'other') as method,
             count(*) as orders, sum(o.total - coalesce(o.refunded_amount, 0)) as sales
      from orders o where ${where} group by 1 order by 3 desc`),
    rows<{ product_id: string | null; title: string; qty: string; sales: string; profit: string | null }>(sql`
      select i.product_id, coalesce(max(p.title), max(i.title_snapshot)) as title,
             sum(i.quantity - i.returned_qty) as qty,
             sum(i.unit_price * (i.quantity - i.returned_qty)) as sales,
             sum((i.unit_price - i.unit_cost) * (i.quantity - i.returned_qty)) filter (where i.unit_cost is not null) as profit
      from order_items i join orders o on o.id = i.order_id left join products p on p.id = i.product_id
      where ${where} group by i.product_id order by 4 desc limit 20`),
    rows<{ id: string; name: string | null; phone: string; orders: string; sales: string; last: string }>(sql`
      select c.id, c.name, c.phone, count(*) as orders, sum(o.total - coalesce(o.refunded_amount, 0)) as sales, max(o.created_at) as last
      from orders o join customers c on c.id = o.customer_record_id
      where ${where} group by c.id order by 5 desc limit 10`),
  ]);

  // Every day in the range, including days without sales (charts need the gaps).
  const byDay = new Map(daily.map((d) => [d.d, d]));
  const days: SalesReport["daily"] = [];
  const dayMs = 86_400_000;
  const startLocal = new Date(range.from.getTime() + 8 * 3_600_000);
  const endLocal = new Date(range.to.getTime() + 8 * 3_600_000 - 1);
  for (let t = Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth(), startLocal.getUTCDate()); t <= endLocal.getTime() && days.length < 400; t += dayMs) {
    const key = new Date(t).toISOString().slice(0, 10);
    const d = byDay.get(key);
    days.push({ date: key, sales: r2(num(d?.sales)), orders: num(d?.orders) });
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    kpis: current,
    previous: { sales: previous.sales, orders: previous.orders, aov: previous.aov },
    daily: days,
    channels: channels.map((c) => ({ channel: c.channel, orders: num(c.orders), sales: r2(num(c.sales)) })),
    payments: payments.map((p) => ({ method: p.method, orders: num(p.orders), sales: r2(num(p.sales)) })),
    products: products.map((p) => ({ productId: p.product_id, title: p.title, qty: num(p.qty), sales: r2(num(p.sales)), profit: p.profit == null ? null : r2(num(p.profit)) })),
    customers: customers.map((c) => ({ customerId: c.id, name: c.name, phone: c.phone, orders: num(c.orders), sales: r2(num(c.sales)), lastOrderAt: new Date(c.last).toISOString() })),
  };
}

// ─── Repeat buyers ───────────────────────────────────────────────────────────

export interface RepeatCohort {
  /** First-order month, YYYY-MM (Manila). */
  month: string;
  customers: number;
  repeat: number;
  within30: number;
  within60: number;
  within90: number;
}

/** Customers grouped by the month of their first order: how many came back, and how fast. */
export async function getRepeatCohorts(tenantId: string, months = 6, now = new Date()): Promise<{ cohorts: RepeatCohort[]; repeatRate: number; customers: number }> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1) - 8 * 3_600_000);
  const list = await rows<{ m: string; customers: string; repeat: string; r30: string; r60: string; r90: string }>(sql`
    with o as (
      select o.customer_record_id as c, o.created_at
      from orders o where o.tenant_id = ${tenantId} and o.customer_record_id is not null and ${COUNTED}
    ), f as (
      select c, min(created_at) as first_at, (array_agg(created_at order by created_at))[2] as second_at, count(*) as n
      from o group by c
    )
    select to_char(first_at at time zone ${TZ}, 'YYYY-MM') as m, count(*) as customers,
           count(*) filter (where n > 1) as repeat,
           count(*) filter (where second_at <= first_at + interval '30 days') as r30,
           count(*) filter (where second_at <= first_at + interval '60 days') as r60,
           count(*) filter (where second_at <= first_at + interval '90 days') as r90
    from f where first_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`);
  const [all] = await rows<{ customers: string; repeat: string }>(sql`
    select count(*) as customers, count(*) filter (where n > 1) as repeat from (
      select o.customer_record_id, count(*) as n from orders o
      where o.tenant_id = ${tenantId} and o.customer_record_id is not null and ${COUNTED}
      group by 1) x`);
  const customers = num(all?.customers);
  return {
    cohorts: list.map((c) => ({ month: c.m, customers: num(c.customers), repeat: num(c.repeat), within30: num(c.r30), within60: num(c.r60), within90: num(c.r90) })),
    repeatRate: customers ? Math.round((num(all?.repeat) / customers) * 1000) / 1000 : 0,
    customers,
  };
}

// ─── Stock value ─────────────────────────────────────────────────────────────

export interface StockValue {
  units: number;
  retailValue: number;
  costValue: number;
  /** Variants in stock without a cost price (their cost isn't in costValue). */
  missingCost: number;
  variants: number;
}

export async function getStockValue(tenantId: string): Promise<StockValue> {
  const [r] = await rows<{ units: string; retail: string; cost: string; missing: string; variants: string }>(sql`
    select coalesce(sum(greatest(v.stock_qty, 0)), 0) as units,
           coalesce(sum(greatest(v.stock_qty, 0) * v.price), 0) as retail,
           coalesce(sum(greatest(v.stock_qty, 0) * v.cost_price) filter (where v.cost_price is not null), 0) as cost,
           count(*) filter (where v.cost_price is null and v.stock_qty > 0) as missing,
           count(*) as variants
    from product_variants v join products p on p.id = v.product_id
    where p.tenant_id = ${tenantId} and p.status <> 'archived' and v.active and coalesce(p.track_inventory, true)`);
  return { units: num(r?.units), retailValue: r2(num(r?.retail)), costValue: r2(num(r?.cost)), missingCost: num(r?.missing), variants: num(r?.variants) };
}

// ─── CSV exports ─────────────────────────────────────────────────────────────

function cell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(header: string[], data: Array<Array<string | number | null | undefined>>): string {
  return `${[header.join(","), ...data.map((r) => r.map(cell).join(","))].join("\r\n")}\r\n`;
}

const manila = (d: Date | string) => new Date(new Date(d).getTime() + 8 * 3_600_000).toISOString().replace("T", " ").slice(0, 16);

export type ReportExport = "orders" | "products" | "customers" | "daily";

export async function reportCsv(tenantId: string, kind: ReportExport, range: ReportRange): Promise<string> {
  if (range.to.getTime() - range.from.getTime() > 366 * 86_400_000) throw new Error("Export up to a year at a time.");
  const inRange = sql`o.tenant_id = ${tenantId} and o.created_at >= ${range.from.toISOString()}::timestamptz and o.created_at < ${range.to.toISOString()}::timestamptz`;
  if (kind === "orders") {
    const list = await rows<Record<string, string | null>>(sql`
      select o.created_at, o.order_number, coalesce(o.sales_channel, '') as sales_channel, o.source_channel, o.guest_name, o.guest_phone,
             (select string_agg(i.quantity || 'x ' || i.title_snapshot, '; ' order by i.id) from order_items i where i.order_id = o.id) as items,
             o.subtotal, o.discount, o.delivery_fee, o.total, o.refunded_amount, o.payment_method,
             o.order_state, o.payment_state, o.fulfillment_state, o.coupon_code, o.invoice_number,
             case when o.voided_at is not null then 'yes' else '' end as voided
      from orders o where ${inRange} order by o.created_at limit 50000`);
    return toCsv(
      ["date", "order_no", "channel", "source", "buyer", "phone", "items", "subtotal", "discount", "delivery", "total", "refunded", "payment", "order_state", "payment_state", "fulfillment", "coupon", "invoice_no", "voided"],
      list.map((o) => [manila(o.created_at!), o.order_number, o.sales_channel, o.source_channel, o.guest_name, o.guest_phone, o.items, o.subtotal, o.discount, o.delivery_fee, o.total, o.refunded_amount, o.payment_method, o.order_state, o.payment_state, o.fulfillment_state, o.coupon_code, o.invoice_number, o.voided])
    );
  }
  if (kind === "products") {
    const list = await rows<Record<string, string | null>>(sql`
      select coalesce(max(p.title), max(i.title_snapshot)) as product, i.title_snapshot as line,
             sum(i.quantity - i.returned_qty) as qty, sum(i.unit_price * (i.quantity - i.returned_qty)) as sales,
             sum(i.unit_cost * (i.quantity - i.returned_qty)) filter (where i.unit_cost is not null) as cost
      from order_items i join orders o on o.id = i.order_id left join products p on p.id = i.product_id
      where ${inRange} and ${COUNTED} group by i.product_id, i.title_snapshot order by 4 desc limit 5000`);
    return toCsv(
      ["product", "item", "qty", "sales", "cost", "profit"],
      list.map((r) => [r.product, r.line, r.qty, Number(r.sales).toFixed(2), r.cost == null ? "" : Number(r.cost).toFixed(2), r.cost == null ? "" : (Number(r.sales) - Number(r.cost)).toFixed(2)])
    );
  }
  if (kind === "customers") {
    const list = await rows<Record<string, string | boolean | null>>(sql`
      select c.name, c.phone, c.email, c.first_order_at, c.last_order_at, c.sms_marketing_opt_in,
             (select count(*) from orders o where o.customer_record_id = c.id and ${COUNTED}) as orders,
             (select coalesce(sum(o.total - coalesce(o.refunded_amount, 0)), 0) from orders o where o.customer_record_id = c.id and ${COUNTED}) as spent
      from customers c where c.tenant_id = ${tenantId} order by 8 desc limit 50000`);
    return toCsv(
      ["name", "phone", "email", "first_order", "last_order", "orders", "spent", "sms_reminders_ok"],
      list.map((c) => [c.name as string, c.phone as string, c.email as string, c.first_order_at ? manila(c.first_order_at as string) : "", c.last_order_at ? manila(c.last_order_at as string) : "", c.orders as string, Number(c.spent).toFixed(2), c.sms_marketing_opt_in ? "yes" : ""])
    );
  }
  const report = await getSalesReport(tenantId, range);
  return toCsv(["date", "orders", "sales"], report.daily.map((d) => [d.date, d.orders, d.sales.toFixed(2)]));
}
