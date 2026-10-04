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
import type { SellerToday } from "@gumakart/db";

/**
 * Plan §10 — "What needs me today?"
 *   To do (tap → the matching Orders tab) · Today (sales, orders, links vs store)
 *   · Deliveries · your newest checkout link · setup checklist for the new flow.
 */

interface TodayResponse {
  ok: boolean;
  today?: SellerToday;
  urls?: { linkBase: string; storefront: string };
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
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            {greeting()}, {displayName.split(" ")[0]}
          </p>
          <h2 className="mt-0.5 flex items-center gap-2 font-display text-xl font-bold text-white">
            {today.shop.name}
            {today.shop.status === "active" && <BadgeCheck className="h-4 w-4 text-emerald-400" />}
          </h2>
        </div>
        <Link
          href="/checkout-links"
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New checkout link
        </Link>
      </div>

      {/* To do */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-200">What needs you today</h3>
          {totalTodo === 0 && <span className="text-xs text-emerald-300">All caught up</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {TODO.map((t) => {
            const n = today.todo[t.key];
            const Icon = t.icon;
            const urgent = n > 0;
            return (
              <Link
                key={t.key}
                href={`/orders?tab=${t.tab}`}
                className={`group rounded-2xl border p-4 transition ${
                  urgent
                    ? t.key === "attention"
                      ? "border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15"
                      : "border-primary/40 bg-primary/10 hover:bg-primary/15"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <Icon className={`h-4 w-4 ${urgent ? "text-white" : "text-slate-500"}`} />
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500 transition group-hover:translate-x-0.5" />
                </div>
                <p className={`mt-3 font-display text-2xl font-bold ${urgent ? "text-white" : "text-slate-400"}`}>{n}</p>
                <p className="text-sm font-medium text-slate-200">{t.label}</p>
                <p className="text-xs text-slate-500">{t.hint}</p>
              </Link>
            );
          })}
        </div>
        {today.todo.to_pay > 0 && (
          <Link href="/orders?tab=to_pay" className="mt-2 inline-block text-xs text-slate-400 hover:text-white">
            {today.todo.to_pay} order{today.todo.to_pay === 1 ? "" : "s"} waiting for the buyer to pay →
          </Link>
        )}
      </section>

      {/* Today + deliveries */}
      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.03] lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Today</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <p className="font-display text-3xl font-bold text-white">{formatPrice(today.today.sales)}</p>
              <p className="text-xs text-slate-400">sales</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold text-white">{today.today.orders}</p>
              <p className="text-xs text-slate-400">orders</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 p-3">
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Link2 className="h-3.5 w-3.5" /> From checkout links
              </p>
              <p className="mt-1 font-semibold text-white">
                {today.today.byChannel.checkoutLinks.orders} · {formatPrice(today.today.byChannel.checkoutLinks.sales)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 p-3">
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Store className="h-3.5 w-3.5" /> From your online store
              </p>
              <p className="mt-1 font-semibold text-white">
                {today.today.byChannel.store.orders} · {formatPrice(today.today.byChannel.store.sales)}
              </p>
            </div>
            <Link href="/pos" className="rounded-xl border border-white/10 p-3 transition hover:border-white/25">
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Calculator className="h-3.5 w-3.5" /> In-store (POS)
              </p>
              <p className="mt-1 font-semibold text-white">
                {today.today.byChannel.pos?.orders ?? 0} · {formatPrice(today.today.byChannel.pos?.sales ?? 0)}
              </p>
            </Link>
          </div>
        </Card>

        <Card className="border-white/10 bg-white/[0.03]">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Deliveries</p>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li className="flex justify-between text-slate-300">
              <span>Rider booked</span>
              <span className="font-semibold text-white">{today.deliveries.booked}</span>
            </li>
            <li className="flex justify-between text-slate-300">
              <span>Out for delivery</span>
              <span className="font-semibold text-white">{today.deliveries.outForDelivery}</span>
            </li>
            <li className="flex justify-between text-slate-300">
              <span>Delivered today</span>
              <span className="font-semibold text-white">{today.deliveries.deliveredToday}</span>
            </li>
          </ul>
          <Link href="/orders?tab=shipping" className="mt-3 inline-block text-xs text-slate-400 hover:text-white">
            See deliveries →
          </Link>
        </Card>
      </section>

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
    </div>
  );
}
