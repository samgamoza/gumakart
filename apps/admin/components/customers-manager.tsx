"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, formatPrice } from "@gumakart/ui";
import { CustomerSuki } from "@/components/loyalty/customer-suki";

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  ordersCount: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  isRepeat: boolean;
}

interface CustomerStats {
  totalCustomers: number;
  repeatCustomers: number;
  newThisMonth: number;
  repeatRate: number;
}

interface CustomerDetail extends CustomerRow {
  notes: string | null;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: string;
    createdAt: string;
  }>;
}

const SORTS = [
  { id: "recent", label: "Recent" },
  { id: "top", label: "Top spenders" },
  { id: "orders", label: "Most orders" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string | null, phone: string): string {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  }
  return phone.slice(-2);
}

export function CustomersManager() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortId>("recent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setCustomers(data.customers);
        setStats(data.stats);
        setError(null);
      } else {
        setError(data.error ?? "Could not load customers.");
      }
    } catch {
      setError("Could not load customers. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [sort, search]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  async function toggleDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers?id=${id}`);
      const data = await res.json();
      if (data.ok) setDetail(data.customer);
    } finally {
      setDetailLoading(false);
    }
  }

  const statCards = stats
    ? [
        { label: "Customers", value: String(stats.totalCustomers) },
        {
          label: "Repeat buyers",
          value: String(stats.repeatCustomers),
          hint: `${Math.round(stats.repeatRate * 100)}% repeat rate`,
        },
        { label: "New this month", value: String(stats.newThisMonth) },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {statCards.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            {s.hint && <p className="mt-0.5 text-xs text-emerald-600">{s.hint}</p>}
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="h-10 flex-1 min-w-[200px] rounded-xl border border-border/60 bg-muted/30 px-4 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
        />
        <div className="flex rounded-xl border border-border/60 p-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                sort === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading customers…</p>
      ) : customers.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium">No customers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Customers appear here automatically after their first order.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <button
                onClick={() => toggleDetail(c.id)}
                className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-muted/30"
              >
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {initials(c.name, c.phone)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{c.name ?? "Guest"}</span>
                    {c.isRepeat && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        REPEAT
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{c.phone}</span>
                </span>
                <span className="flex-none text-right">
                  <span className="block text-sm font-semibold">{formatPrice(c.totalSpent)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.ordersCount} order{c.ordersCount === 1 ? "" : "s"} · {relativeTime(c.lastOrderAt)}
                  </span>
                </span>
              </button>

              {openId === c.id && (
                <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
                  {detailLoading || !detail ? (
                    <p className="text-xs text-muted-foreground">Loading history…</p>
                  ) : (
                    <div className="space-y-2">
                      <CustomerSuki customerId={c.id} />
                      {detail.email && (
                        <p className="text-xs text-muted-foreground">{detail.email}</p>
                      )}
                      <p className="text-xs font-medium text-muted-foreground">Order history</p>
                      {detail.orders.map((o) => (
                        <div
                          key={o.id}
                          className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-xs"
                        >
                          <span className="font-medium">{o.orderNumber}</span>
                          <span className="capitalize text-muted-foreground">
                            {o.status.replace(/_/g, " ")}
                          </span>
                          <span className="font-semibold">{formatPrice(Number(o.total))}</span>
                          <span className="text-muted-foreground">{relativeTime(o.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
