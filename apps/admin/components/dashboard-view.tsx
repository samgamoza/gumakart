"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Link2,
  Package,
  Plus,
  ShoppingBag,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { Card, formatPrice } from "@gumakart/ui";
import type { LowStockSummary, SellerToday } from "@gumakart/db";
import { AskGuma } from "@/components/ai/ask-guma";
import { RestockCard } from "@/components/ai/restock-card";

/**
 * Plan §10 — "What needs me today?"
 *   To do (tap → the matching Orders tab) · Today (sales, orders, links vs store)
 *   · Deliveries · your newest checkout link · setup checklist for the new flow.
 */

interface TodayResponse {
  ok: boolean;
  today?: SellerToday;
  urls?: { linkBase: string; storefront: string };
  lowStock?: LowStockSummary | null;
  error?: string;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const TODO = [
  { key: "to_confirm", label: "Payments to confirm", hint: "Buyer sent proof", icon: Wallet, tab: "to_confirm" },
  { key: "to_pack", label: "To pack", hint: "Paid or COD", icon: Package, tab: "to_pack" },
  { key: "to_ship", label: "To book delivery", hint: "Packed, needs a rider", icon: Truck, tab: "to_ship" },
  { key: "attention", label: "Delivery problems", hint: "Failed or returned", icon: AlertTriangle, tab: "attention" },
] as const;

export function DashboardView({ displayName }: { displayName: string }) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/today", { cache: "no-store" });
      setData((await res.json()) as TodayResponse);
    } catch {
      setData({ ok: false, error: "Couldn't load your dashboard. Check your connection." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }
  if (!data.ok || !data.today || !data.urls) {
    return <p className="text-sm text-red-300">{data.error ?? "Couldn't load your dashboard."}</p>;
  }

  const { today, urls } = data;
  const linkUrl = today.latestLink ? `${urls.linkBase}${today.latestLink.code}` : null;
  const totalTodo = today.todo.to_confirm + today.todo.to_pack + today.todo.to_ship + today.todo.attention;
  const required = today.setup.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
    } catch {
      /* clipboard blocked; the link is visible to copy by hand */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-6">
      {/* Greeting — Phase 34 Palenke header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="pk-chip">Seller dashboard</span>
          <h2 className="mt-2 flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {today.shop.name}
            {today.shop.status === "active" && <BadgeCheck className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {greeting()}, {displayName.split(" ")[0]} — here&apos;s your shop today.
          </p>
        </div>
        <Link
          href="/checkout-links"
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-600/25 transition hover:-translate-y-0.5 hover:bg-violet-700 dark:shadow-none"
        >
          <Plus className="h-4 w-4" /> New checkout link
        </Link>
      </div>

      {/* To do */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="pk-label">What needs you today</h3>
          {totalTodo === 0 && <span className="pk-chip !bg-emerald-50 !text-emerald-700 dark:!bg-emerald-500/15 dark:!text-emerald-200">All caught up</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {TODO.map((t) => {
            const n = today.todo[t.key];
            const Icon = t.icon;
            const urgent = n > 0;
            const warn = t.key === "attention";
            return (
              <Link
                key={t.key}
                href={`/orders?tab=${t.tab}`}
                data-testid={`todo-${t.key}`}
                className={`group rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_10px_30px_-18px_rgba(15,23,42,.18)] transition hover:-translate-y-0.5 dark:shadow-none ${
                  urgent
                    ? warn
                      ? "border-amber-300 ring-1 ring-amber-200 dark:border-amber-400/40 dark:bg-amber-400/10 dark:ring-0"
                      : "border-violet-300 ring-1 ring-violet-200 dark:border-primary/40 dark:bg-primary/10 dark:ring-0"
                    : "border-slate-200 dark:border-white/10 dark:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-xl ${
                      warn ? "bg-amber-50 text-amber-600 dark:bg-amber-400/15 dark:text-amber-200" : "bg-violet-50 text-violet-600 dark:bg-white/10 dark:text-slate-200"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {urgent ? (
                    <span className={`pk-chip ${warn ? "!bg-amber-50 !text-amber-700 dark:!bg-amber-400/15 dark:!text-amber-200" : ""}`}>Needs you</span>
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5" />
                  )}
                </div>
                <p className="pk-label mt-4">{t.label}</p>
                <p className={`mt-1 font-display text-3xl font-bold tracking-tight ${urgent ? "text-slate-900 dark:text-white" : "text-slate-300 dark:text-slate-500"}`}>{n}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.hint}</p>
              </Link>
            );
          })}
        </div>
        {today.todo.to_pay > 0 && (
          <Link href="/orders?tab=to_pay" className="mt-2 inline-block text-xs text-slate-500 hover:text-violet-700 dark:text-slate-400 dark:hover:text-white">
            {today.todo.to_pay} order{today.todo.to_pay === 1 ? "" : "s"} waiting for the buyer to pay →
          </Link>
        )}
        {data.lowStock && data.lowStock.lowCount > 0 && (
          <Link
            href="/inventory?filter=low"
            className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 transition hover:bg-amber-100/70 dark:border-amber-400/25 dark:bg-amber-400/[0.06] dark:hover:bg-amber-400/10"
            data-testid="low-stock-alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-300" />
            <span className="min-w-0 text-sm">
              <span className="font-semibold text-amber-900 dark:text-amber-100">
                {data.lowStock.lowCount} item{data.lowStock.lowCount === 1 ? "" : "s"} running low
                {data.lowStock.soldOutCount > 0 ? ` · ${data.lowStock.soldOutCount} sold out` : ""}
              </span>
              <span className="block truncate text-xs text-amber-800/70 dark:text-slate-400">
                {data.lowStock.items.map((i) => `${i.title} (${i.stockQty})`).join(" · ")}
              </span>
            </span>
            <span className="ml-auto flex-none text-xs font-semibold text-amber-700 dark:text-amber-200">Restock →</span>
          </Link>
        )}
      </section>

      {/* Today + deliveries — the violet hero card is palenkeAi's signature */}
      <section className="grid gap-3 lg:grid-cols-3">
        <div
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#14062b] via-[#3b0f7a] to-[#6d28d9] p-5 text-white shadow-xl shadow-violet-900/20 lg:col-span-2"
          data-testid="today-hero"
        >
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-fuchsia-400/20" />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200 dark:text-violet-200">Today</p>
          <div className="relative mt-2 flex flex-wrap items-end gap-x-10 gap-y-2">
            <div>
              <p className="font-display text-4xl font-bold tracking-tight">{formatPrice(today.today.sales)}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200/80 dark:text-violet-200/80">Sales</p>
            </div>
            <div>
              <p className="font-display text-4xl font-bold tracking-tight">{today.today.orders}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200/80 dark:text-violet-200/80">Orders</p>
            </div>
          </div>
          <div className="relative mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm dark:bg-white/10">
              <p className="flex items-center gap-1.5 text-xs text-violet-100 dark:text-violet-100">
                <Link2 className="h-3.5 w-3.5" /> From checkout links
              </p>
              <p className="mt-1 font-semibold">
                {today.today.byChannel.checkoutLinks.orders} · {formatPrice(today.today.byChannel.checkoutLinks.sales)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm dark:bg-white/10">
              <p className="flex items-center gap-1.5 text-xs text-violet-100 dark:text-violet-100">
                <Store className="h-3.5 w-3.5" /> From your online store
              </p>
              <p className="mt-1 font-semibold">
                {today.today.byChannel.store.orders} · {formatPrice(today.today.byChannel.store.sales)}
              </p>
            </div>
            <Link href="/pos" className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm transition hover:bg-white/20 dark:bg-white/10">
              <p className="flex items-center gap-1.5 text-xs text-violet-100 dark:text-violet-100">
                <Calculator className="h-3.5 w-3.5" /> In-store (POS)
              </p>
              <p className="mt-1 font-semibold">
                {today.today.byChannel.pos?.orders ?? 0} · {formatPrice(today.today.byChannel.pos?.sales ?? 0)}
              </p>
            </Link>
          </div>
        </div>

        <Card className="dark:border-white/10 dark:bg-white/[0.03]">
          <p className="pk-label">Deliveries</p>
          <ul className="mt-3 space-y-2.5 text-sm">
            {[
              ["Rider booked", today.deliveries.booked],
              ["Out for delivery", today.deliveries.outForDelivery],
              ["Delivered today", today.deliveries.deliveredToday],
            ].map(([label, n]) => (
              <li key={String(label)} className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                <span>{label}</span>
                <span className="font-display text-base font-bold text-slate-900 dark:text-white">{n}</span>
              </li>
            ))}
          </ul>
          <Link href="/orders?tab=shipping" className="mt-3 inline-block text-xs font-semibold text-violet-700 hover:text-violet-900 dark:text-slate-400 dark:hover:text-white">
            See deliveries →
          </Link>
        </Card>
      </section>

      <RestockCard />

      {/* Checkout link */}
      <Card className="border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
            <Link2 className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              {today.latestLink ? "Your newest checkout link" : "Make your first checkout link"}
            </p>
            <p className="text-xs text-slate-400">
              Paste it in your FB post, IG bio, TikTok or Messenger chat. Buyers order on one page.
            </p>
          </div>
        </div>
        {today.latestLink && linkUrl ? (
          <>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 py-2 pl-3 pr-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                <span className="font-medium">{today.latestLink.title}</span>
                <span className="ml-2 font-mono text-xs text-primary">{linkUrl.replace(/^https?:\/\//, "")}</span>
              </span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex flex-none items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {today.latestLink.viewCount} views · {today.latestLink.orderCount} orders ·{" "}
              <Link href="/checkout-links" className="text-slate-300 hover:underline">
                All {today.linkCount} link{today.linkCount === 1 ? "" : "s"}
              </Link>
            </p>
          </>
        ) : (
          <Link
            href="/checkout-links"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.05]"
          >
            <Plus className="h-4 w-4" /> New checkout link
          </Link>
        )}
      </Card>

      {/* Setup */}
      {(requiredDone < required.length || today.setup.some((s) => s.optional && !s.done)) && (
        <Card className="border-white/10 bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {requiredDone < required.length ? "Finish setting up" : "You're set up"}
              </p>
              <p className="text-xs text-slate-400">
                {requiredDone} of {required.length} done
              </p>
            </div>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.round((requiredDone / Math.max(1, required.length)) * 100)}%` }}
              />
            </div>
          </div>
          <ul className="space-y-2">
            {today.setup.map((step) => (
              <li
                key={step.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5"
              >
                <span className="flex items-center gap-2.5 text-sm">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 flex-none text-emerald-400" />
                  ) : (
                    <Circle className="h-4 w-4 flex-none text-slate-600" />
                  )}
                  <span className={step.done ? "text-slate-500 line-through" : "text-slate-200"}>{step.label}</span>
                  {step.optional && !step.done && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">
                      optional
                    </span>
                  )}
                </span>
                {!step.done && (
                  <Link
                    href={step.href}
                    className="flex-none rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-white/[0.06]"
                  >
                    {step.action}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Shortcuts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/orders", label: "Orders", icon: ShoppingBag },
          { href: "/products", label: "Products", icon: Package },
          { href: "/customers", label: "Customers", icon: BadgeCheck },
        ].map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-200 hover:bg-white/[0.06]"
          >
            <s.icon className="h-4 w-4 text-slate-500" /> {s.label}
          </Link>
        ))}
        {today.shop.status === "active" && (
          <a
            href={urls.storefront}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-200 hover:bg-white/[0.06]"
          >
            <ExternalLink className="h-4 w-4 text-slate-500" /> Online store
          </a>
        )}
      </div>
      <AskGuma />
    </div>
  );
}
