"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Table2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, formatPrice } from "@gumakart/ui";
import { ForecastCard } from "@/components/ai/forecast-card";

/**
 * Phase 14 — Reports: sales over time, by channel, products, customers, repeat buyers,
 * stock value, and CSV exports. Manila dates. Owner + manager only (reports.view).
 */

interface Kpis {
  sales: number;
  orders: number;
  aov: number;
  itemsSold: number;
  discounts: number;
  refunds: number;
  deliveryFees: number;
  profit: number | null;
  costCoverage: number;
  newCustomers: number;
  returningCustomers: number;
}

interface Data {
  ok: boolean;
  error?: string;
  label: string;
  report: {
    kpis: Kpis;
    previous: { sales: number; orders: number; aov: number };
    daily: Array<{ date: string; sales: number; orders: number }>;
    channels: Array<{ channel: string; orders: number; sales: number }>;
    payments: Array<{ method: string; orders: number; sales: number }>;
    products: Array<{ productId: string | null; title: string; qty: number; sales: number; profit: number | null }>;
    customers: Array<{ customerId: string; name: string | null; phone: string; orders: number; sales: number; lastOrderAt: string }>;
  };
  repeat: { cohorts: Array<{ month: string; customers: number; repeat: number; within30: number; within60: number; within90: number }>; repeatRate: number; customers: number };
  stock: { units: number; retailValue: number; costValue: number; missingCost: number; variants: number };
}

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "year", label: "This year" },
];

const CHANNEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
  shopee: "Shopee",
  lazada: "Lazada",
  sms: "SMS campaigns",
  pos: "In store (POS)",
  direct: "Direct / other links",
  other: "Other",
};

const PAYMENT: Record<string, string> = { cod: "Cash on delivery", gcash: "GCash", maya: "Maya", paymaya: "Maya", cash: "Cash", card: "Card", bank: "Bank", qrph: "QR Ph", shopee: "Shopee", lazada: "Lazada" };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const d = (now - before) / before;
  return { text: `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`, up: d >= 0 };
}

export function ReportsView() {
  const [preset, setPreset] = useState("30d");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = custom ? `from=${custom.from}&to=${custom.to}` : `preset=${preset}`;
  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/reports?${query}`, { cache: "no-store" });
    const d = (await res.json().catch(() => ({ ok: false }))) as Data;
    setLoading(false);
    if (d.ok) {
      setData(d);
      setError(null);
    } else setError(d.error ?? "Could not load the report.");
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Filters: one row above everything */}
      <div className="flex flex-wrap items-center gap-2" data-testid="report-filters">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setCustom(null);
              setPreset(p.id);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${!custom && preset === p.id ? "bg-violet-600 text-white" : "bg-white/5 text-muted-foreground hover:text-foreground"}`}
            aria-pressed={!custom && preset === p.id}
          >
            {p.label}
          </button>
        ))}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="date" max={today} className="guma-field h-8 w-36 text-xs" value={custom?.from ?? ""} onChange={(e) => setCustom({ from: e.target.value, to: custom?.to ?? today })} aria-label="From" />
          –
          <input type="date" max={today} className="guma-field h-8 w-36 text-xs" value={custom?.to ?? ""} onChange={(e) => setCustom({ from: custom?.from ?? e.target.value, to: e.target.value })} aria-label="To" />
        </span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ForecastCard />
      {!data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Building the report…
        </p>
      ) : (
        <ReportBody data={data} query={query} />
      )}
    </div>
  );
}

function Kpi({ label, value, sub, delta, testid }: { label: string; value: string; sub?: string | null; delta?: { text: string; up: boolean } | null; testid?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight" data-testid={testid}>
        {value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        {delta && (
          <span className={`inline-flex items-center gap-0.5 font-medium ${delta.up ? "text-emerald-300" : "text-red-300"}`}>
            {delta.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.text}
          </span>
        )}
        {sub}
      </p>
    </Card>
  );
}

function ReportBody({ data, query }: { data: Data; query: string }) {
  const { kpis, previous } = data.report;
  const exportHref = (type: string) => `/api/reports/export?type=${type}&${query}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Sales · ${data.label}`} value={formatPrice(kpis.sales)} delta={change(kpis.sales, previous.sales)} sub="vs the period before" testid="kpi-sales" />
        <Kpi label="Orders" value={String(kpis.orders)} delta={change(kpis.orders, previous.orders)} sub={`${kpis.itemsSold} items`} />
        <Kpi label="Average order" value={formatPrice(kpis.aov)} delta={change(kpis.aov, previous.aov)} />
        <Kpi
          label="Gross profit"
          value={kpis.profit === null ? "—" : formatPrice(kpis.profit)}
          sub={kpis.profit === null ? "Add cost prices on the Stock page" : kpis.costCoverage < 1 ? `${pct(kpis.costCoverage)} of items have a cost` : "All items have a cost"}
          testid="kpi-profit"
        />
        <Kpi label="New buyers" value={String(kpis.newCustomers)} sub={`${kpis.returningCustomers} came back`} />
        <Kpi label="Repeat buyers (all time)" value={pct(data.repeat.repeatRate)} sub={`of ${data.repeat.customers} buyers ordered again`} />
        <Kpi label="Discounts given" value={formatPrice(kpis.discounts)} />
        <Kpi label="Refunded" value={formatPrice(kpis.refunds)} />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Sales by day</h2>
        </div>
        <DailyChart daily={data.report.daily} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">By channel</h2>
          <BarList rows={data.report.channels.map((c) => ({ key: c.channel, label: CHANNEL[c.channel] ?? c.channel, value: c.sales, sub: `${c.orders} order${c.orders === 1 ? "" : "s"}` }))} />
          <Link href="/channels" className="mt-2 inline-block text-xs text-violet-300 hover:underline">
            Tag your links per channel →
          </Link>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">By payment</h2>
          <BarList rows={data.report.payments.map((p) => ({ key: p.method, label: PAYMENT[p.method] ?? p.method, value: p.sales, sub: `${p.orders} order${p.orders === 1 ? "" : "s"}` }))} />
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Top products</h2>
          <a className="inline-flex items-center gap-1 text-xs text-violet-300 hover:underline" href={exportHref("products")}>
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
        </div>
        {data.report.products.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No sales in this period.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm" data-testid="report-products">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Product</th>
                  <th className="py-1.5 text-right font-medium">Sold</th>
                  <th className="py-1.5 text-right font-medium">Sales</th>
                  <th className="py-1.5 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data.report.products.map((p) => (
                  <tr key={p.productId ?? p.title}>
                    <td className="py-1.5 pr-2">{p.title}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.qty}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatPrice(p.sales)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{p.profit === null ? "—" : formatPrice(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Top buyers</h2>
            <a className="inline-flex items-center gap-1 text-xs text-violet-300 hover:underline" href={exportHref("customers")}>
              <Download className="h-3.5 w-3.5" /> All customers CSV
            </a>
          </div>
          {data.report.customers.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No buyers with a number yet in this period.</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/10 text-sm">
              {data.report.customers.map((c) => (
                <li key={c.customerId} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{c.name ?? c.phone}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.orders} order{c.orders === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatPrice(c.sales)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Do buyers come back?</h2>
          <p className="text-xs text-muted-foreground">Buyers by the month of their first order, and how many ordered again.</p>
          {data.repeat.cohorts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Not enough orders yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm" data-testid="report-cohorts">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">First order</th>
                  <th className="py-1.5 text-right font-medium">Buyers</th>
                  <th className="py-1.5 text-right font-medium">Within 30d</th>
                  <th className="py-1.5 text-right font-medium">90d</th>
                  <th className="py-1.5 text-right font-medium">Ever</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data.repeat.cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className="py-1.5">{new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.customers}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.customers ? pct(c.within30 / c.customers) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.customers ? pct(c.within90 / c.customers) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.customers ? pct(c.repeat / c.customers) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Stock on hand</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Units</p>
            <p className="text-lg font-bold tabular-nums">{data.stock.units.toLocaleString("en-PH")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">At selling price</p>
            <p className="text-lg font-bold tabular-nums">{formatPrice(data.stock.retailValue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">At cost</p>
            <p className="text-lg font-bold tabular-nums" data-testid="stock-cost">
              {formatPrice(data.stock.costValue)}
            </p>
            {data.stock.missingCost > 0 && (
              <Link href="/inventory" className="text-xs text-amber-300 hover:underline">
                {data.stock.missingCost} item{data.stock.missingCost === 1 ? "" : "s"} without a cost →
              </Link>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Export for Excel / Sheets</h2>
        <p className="text-xs text-muted-foreground">For your accountant or your own sheets. Uses the dates above (up to a year).</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { type: "orders", label: "Orders" },
            { type: "products", label: "Products sold" },
            { type: "customers", label: "Customers" },
            { type: "daily", label: "Sales by day" },
          ].map((e) => (
            <a key={e.type} href={exportHref(e.type)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-sm hover:bg-white/5" data-testid={`export-${e.type}`}>
              <Download className="h-4 w-4" /> {e.label}
            </a>
          ))}
        </div>
      </Card>
    </>
  );
}

/** Horizontal bars, one hue, value + label as text (not color). */
function BarList({ rows }: { rows: Array<{ key: string; label: string; value: number; sub: string }> }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No sales in this period.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="mt-3 space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-2">
            <span>{r.label}</span>
            <span className="tabular-nums">
              {formatPrice(r.value)} <span className="text-xs text-muted-foreground">· {r.sub}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-white/5">
            <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily sales: one series → no legend; per-bar hover/focus tooltip; table toggle. */
function DailyChart({ daily }: { daily: Array<{ date: string; sales: number; orders: number }> }) {
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const max = useMemo(() => Math.max(...daily.map((d) => d.sales), 1), [daily]);
  const H = 180;
  const n = daily.length || 1;
  const gap = n > 60 ? 1 : 2;
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
  // Recessive grid: three lines at nice round values.
  const step = niceStep(max / 3);
  const lines = [step, step * 2, step * 3].filter((v) => v <= max * 1.05);
  const every = Math.max(1, Math.ceil(n / 8));
  const total = daily.reduce((s, d) => s + d.sales, 0);
  if (total === 0) return <p className="mt-3 text-sm text-muted-foreground">No sales in this period.</p>;
  return (
    <div className="mt-3">
      <div className="mb-2 flex justify-end">
        <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          <Table2 className="h-3.5 w-3.5" /> {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">Orders</th>
                <th className="py-1 text-right font-medium">Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {daily.map((d) => (
                <tr key={d.date}>
                  <td className="py-1">{label(d.date)}</td>
                  <td className="py-1 text-right tabular-nums">{d.orders}</td>
                  <td className="py-1 text-right tabular-nums">{formatPrice(d.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative" data-testid="daily-chart">
          <div className="relative ml-12" style={{ height: H }}>
            {lines.map((v) => (
              <div key={v} className="pointer-events-none absolute inset-x-0 border-t border-white/[0.06]" style={{ bottom: (v / max) * H }}>
                <span className="absolute -left-12 -top-2 w-10 text-right text-[10px] text-muted-foreground">{short(v)}</span>
              </div>
            ))}
            <div className="absolute inset-0 flex items-end" style={{ gap }}>
              {daily.map((d, i) => (
                <button
                  key={d.date}
                  type="button"
                  className="group relative flex h-full flex-1 items-end focus:outline-none"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((h) => (h === i ? null : h))}
                  aria-label={`${label(d.date)}: ${formatPrice(d.sales)}, ${d.orders} orders`}
                >
                  <span
                    className={`block w-full rounded-t-[4px] ${hover === i ? "bg-violet-400" : "bg-violet-500"}`}
                    style={{ height: d.sales > 0 ? Math.max((d.sales / max) * H, 2) : 0 }}
                  />
                </button>
              ))}
            </div>
            {hover !== null && daily[hover] && (
              <div
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-[#111827] px-2.5 py-1.5 text-xs shadow-lg"
                style={{ left: `${((hover + 0.5) / n) * 100}%` }}
                role="status"
              >
                <p className="font-semibold tabular-nums">{formatPrice(daily[hover]!.sales)}</p>
                <p className="text-muted-foreground">
                  {label(daily[hover]!.date)} · {daily[hover]!.orders} order{daily[hover]!.orders === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>
          <div className="ml-12 mt-1 flex text-[10px] text-muted-foreground">
            {daily.map((d, i) => (
              <span key={d.date} className="flex-1 text-center">
                {i % every === 0 ? label(d.date) : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function short(v: number): string {
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `₱${Math.round(v / 100) / 10}k`;
  return `₱${Math.round(v)}`;
}
