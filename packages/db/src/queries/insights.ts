import { sql } from "drizzle-orm";
import { getDb } from "../client";
import { getSalesReport } from "./reports";

/**
 * Phase 26: shop insights for the AI assistant and the restock card.
 * Everything here is plain arithmetic on the shop's own orders and stock — the AI only phrases it.
 */

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await getDb().execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const COUNTED = sql`coalesce(o.order_state::text, 'open') <> 'cancelled' and o.voided_at is null`;

export interface RestockSuggestion {
  productId: string;
  variantId: string;
  title: string;
  stock: number;
  /** Units sold (net of returns) in the window. */
  sold: number;
  perDay: number;
  /** null = no recent sales, so no run-out date. */
  daysLeft: number | null;
  /** Units to order to cover `coverDays` of sales, after what's on hand. */
  suggestedQty: number;
}

/** Pure: turn sales velocity into a restock line. Exported for tests. */
export function restockLine(input: { stock: number; sold: number; windowDays: number; coverDays: number }) {
  const perDay = input.windowDays > 0 ? input.sold / input.windowDays : 0;
  const stock = Math.max(0, input.stock);
  const daysLeft = perDay > 0 ? Math.floor(stock / perDay) : null;
  const suggestedQty = perDay > 0 ? Math.max(0, Math.ceil(perDay * input.coverDays - stock)) : 0;
  return { perDay: Math.round(perDay * 100) / 100, daysLeft, suggestedQty };
}

/**
 * Active variants that sold in the last `windowDays` and will run out within `alertDays`
 * (or are already out), most urgent first. Stock is the variant's total (all branches).
 */
export async function getRestockSuggestions(
  tenantId: string,
  opts: { windowDays?: number; coverDays?: number; alertDays?: number; limit?: number; now?: Date } = {}
): Promise<RestockSuggestion[]> {
  const windowDays = opts.windowDays ?? 30;
  const coverDays = opts.coverDays ?? 14;
  const alertDays = opts.alertDays ?? 14;
  const since = new Date((opts.now ?? new Date()).getTime() - windowDays * 86_400_000);
  const data = await rows<{ product_id: string; variant_id: string; title: string; variant_title: string; options: unknown; stock: number | null; sold: string }>(sql`
    select p.id as product_id, v.id as variant_id, p.title, v.title as variant_title, p.options_json as options,
           coalesce(v.stock_qty, 0) as stock,
           coalesce(sum(i.quantity - i.returned_qty), 0) as sold
    from product_variants v
    join products p on p.id = v.product_id
    join order_items i on i.variant_id = v.id
    join orders o on o.id = i.order_id
    where p.tenant_id = ${tenantId} and p.status = 'active' and v.active
      and o.tenant_id = ${tenantId} and o.created_at >= ${since.toISOString()}::timestamptz and ${COUNTED}
    group by p.id, v.id, p.title, v.title, p.options_json, v.stock_qty
    having coalesce(sum(i.quantity - i.returned_qty), 0) > 0`);
  return data
    .map((d) => {
      const sold = num(d.sold);
      const stock = num(d.stock);
      const line = restockLine({ stock, sold, windowDays, coverDays });
      const hasOptions = Array.isArray(d.options) && d.options.length > 0;
      return {
        productId: d.product_id,
        variantId: d.variant_id,
        title: hasOptions && d.variant_title ? `${d.title} — ${d.variant_title}` : d.title,
        stock,
        sold,
        ...line,
      };
    })
    .filter((r) => r.daysLeft !== null && r.daysLeft <= alertDays)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || b.perDay - a.perDay)
    .slice(0, opts.limit ?? 20);
}

export interface AdvisorFactsRow {
  shopName: string;
  periodDays: number;
  sales: number;
  orders: number;
  aov: number;
  previousSales: number;
  topProducts: Array<{ title: string; units: number; sales: number }>;
  restock: Array<{ title: string; stock: number; daysLeft: number | null; suggestedQty: number }>;
  pendingPayments: number;
  toShip: number;
}

/** The facts "Ask Guma" may use — the last 30 days vs the 30 before, top sellers, run-outs, to-dos. */
export async function getAdvisorFacts(tenantId: string, opts: { periodDays?: number; now?: Date } = {}): Promise<AdvisorFactsRow> {
  const periodDays = opts.periodDays ?? 30;
  const to = opts.now ?? new Date();
  const from = new Date(to.getTime() - periodDays * 86_400_000);
  const [report, restock, [t], [todo]] = await Promise.all([
    getSalesReport(tenantId, { from, to }),
    getRestockSuggestions(tenantId, { windowDays: periodDays, limit: 5, now: to }),
    rows<{ name: string }>(sql`select name from tenants where id = ${tenantId}`),
    rows<{ pending: string; to_ship: string }>(sql`
      select count(*) filter (where o.payment_state = 'pending_verification') as pending,
             count(*) filter (where coalesce(o.fulfillment_state::text, 'unfulfilled') in ('unfulfilled', 'ready')
                              and coalesce(o.payment_state::text, 'unpaid') in ('paid', 'cod_due')) as to_ship
      from orders o where o.tenant_id = ${tenantId} and ${COUNTED} and o.created_at >= ${new Date(to.getTime() - 60 * 86_400_000).toISOString()}::timestamptz`),
  ]);
  return {
    shopName: t?.name ?? "Shop",
    periodDays,
    sales: report.kpis.sales,
    orders: report.kpis.orders,
    aov: report.kpis.aov,
    previousSales: report.previous.sales,
    topProducts: report.products.slice(0, 5).map((p) => ({ title: p.title, units: p.qty, sales: r2(p.sales) })),
    restock: restock.map((r) => ({ title: r.title, stock: r.stock, daysLeft: r.daysLeft, suggestedQty: r.suggestedQty })),
    pendingPayments: num(todo?.pending),
    toShip: num(todo?.to_ship),
  };
}

/**
 * Short product facts for suggested chat replies: name, price (or range) and whether it's in
 * stock — best sellers of the last 30 days first. Only what the shop has entered.
 */
export async function getReplyFacts(tenantId: string, limit = 15): Promise<string[]> {
  const data = await rows<{ title: string; min_price: string; max_price: string; stock: string }>(sql`
    select p.title, min(v.price) as min_price, max(v.price) as max_price, coalesce(sum(greatest(v.stock_qty, 0)), 0) as stock,
           coalesce((select sum(i.quantity) from order_items i join orders o on o.id = i.order_id
                     where i.product_id = p.id and o.tenant_id = ${tenantId}
                       and o.created_at >= now() - interval '30 days'), 0) as recent
    from products p join product_variants v on v.product_id = p.id and v.active
    where p.tenant_id = ${tenantId} and p.status = 'active'
    group by p.id, p.title
    order by recent desc, p.title
    limit ${limit}`);
  const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
  return data.map((d) => {
    const lo = num(d.min_price);
    const hi = num(d.max_price);
    const price = lo === hi ? peso(lo) : `${peso(lo)}–${peso(hi)}`;
    const stock = num(d.stock);
    return `${d.title}: ${price}, ${stock > 0 ? `${stock} in stock` : "out of stock"}`;
  });
}

// ── Phase 33 (H10, palenkeAi "RevenueForecastTab") ─────────────────────────────────────────────
// Honest version: only after 3 months of history, and always a range from the shop's own weekly
// sales, never one invented number. Sales = same definition as Reports (not cancelled/voided, minus refunds).

export const FORECAST_MIN_HISTORY_DAYS = 90;
const FORECAST_WEEKS = 12;

export type RevenueForecast =
  | { ready: false; historyDays: number; needDays: number }
  | {
      ready: true;
      /** Likely sales for the next 30 days (about 8 in 10 months land inside). */
      low: number;
      high: number;
      basisWeeks: number;
      /** Actual sales in the last 30 days, for comparison. */
      last30: number;
      /** Last 4 weeks vs the 8 before, in % (a fact about the past, not a prediction). */
      trendPct: number | null;
    };

/** Pure: weekly totals (oldest first) → 30-day range. Exported for tests. */
export function forecastRange(weekly: number[]): { low: number; high: number } {
  const n = weekly.length;
  if (n === 0) return { low: 0, high: 0 };
  const mean = weekly.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : mean * 0.5;
  const weeks = 30 / 7;
  const center = mean * weeks;
  const spread = 1.28 * sd * Math.sqrt(weeks); // ~80% band, weeks treated as independent
  const round = (v: number) => Math.round(v / 100) * 100;
  return { low: Math.max(0, round(center - spread)), high: Math.max(0, round(center + spread)) };
}

export function trendPct(weekly: number[]): number | null {
  if (weekly.length < 12) return null;
  const recent = weekly.slice(-4).reduce((a, b) => a + b, 0) / 4;
  const before = weekly.slice(-12, -4).reduce((a, b) => a + b, 0) / 8;
  if (before <= 0) return null;
  return Math.round(((recent - before) / before) * 100);
}

export async function getRevenueForecast(tenantId: string, opts: { now?: Date } = {}): Promise<RevenueForecast> {
  const now = opts.now ?? new Date();
  const [first] = await rows<{ first_at: string | null }>(sql`
    select min(o.created_at) as first_at from orders o where o.tenant_id = ${tenantId} and ${COUNTED}`);
  const historyDays = first?.first_at ? Math.floor((now.getTime() - new Date(first.first_at).getTime()) / 86_400_000) : 0;
  if (historyDays < FORECAST_MIN_HISTORY_DAYS) return { ready: false, historyDays, needDays: FORECAST_MIN_HISTORY_DAYS };

  const since = new Date(now.getTime() - FORECAST_WEEKS * 7 * 86_400_000);
  const data = await rows<{ wk: number; sales: string }>(sql`
    select floor(extract(epoch from (${now.toISOString()}::timestamptz - o.created_at)) / 604800)::int as wk,
           sum(o.total - coalesce(o.refunded_amount, 0)) as sales
    from orders o
    where o.tenant_id = ${tenantId} and ${COUNTED}
      and o.created_at >= ${since.toISOString()}::timestamptz and o.created_at < ${now.toISOString()}::timestamptz
    group by 1`);
  // wk 0 = the most recent 7 days; build oldest → newest with empty weeks as 0.
  const weekly = Array.from({ length: FORECAST_WEEKS }, (_, i) => {
    const wk = FORECAST_WEEKS - 1 - i;
    return num(data.find((d) => Number(d.wk) === wk)?.sales);
  });
  const [last] = await rows<{ sales: string | null }>(sql`
    select sum(o.total - coalesce(o.refunded_amount, 0)) as sales from orders o
    where o.tenant_id = ${tenantId} and ${COUNTED}
      and o.created_at >= ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz
      and o.created_at < ${now.toISOString()}::timestamptz`);
  return { ready: true, ...forecastRange(weekly), basisWeeks: FORECAST_WEEKS, last30: r2(num(last?.sales)), trendPct: trendPct(weekly) };
}
