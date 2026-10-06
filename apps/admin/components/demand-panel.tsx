"use client";

import { useEffect, useState } from "react";
import { Bell, CalendarClock, Heart } from "lucide-react";
import { Card } from "@gumakart/ui";
import type { DemandSummary } from "@gumakart/db";
import { useShopRole } from "@/lib/use-shop-role";

type Contact = { id: string; variantTitle: string | null; phone: string | null; email: string | null; createdAt: string };

/**
 * Phase 22: what buyers want that isn't on the shelf — waiting for a restock, saved, or pre-ordered.
 * Real counts only (no estimates). Hidden until there's something to show.
 */
export function DemandPanel() {
  const [data, setData] = useState<DemandSummary | null>(null);
  const [open, setOpen] = useState<{ productId: string; title: string; contacts: Contact[] | null } | null>(null);
  const { can } = useShopRole();

  useEffect(() => {
    void fetch("/api/demand", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.ok && setData(d))
      .catch(() => undefined);
  }, []);

  async function showContacts(productId: string, title: string) {
    setOpen({ productId, title, contacts: null });
    const d = await fetch(`/api/demand/waiting/${productId}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ ok: false }));
    setOpen({ productId, title, contacts: d.ok ? d.contacts : [] });
  }

  if (!data || data.totals.waiting + data.totals.saves + data.totals.preorderUnits === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="demand-panel">
      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4 text-violet-400" /> Waiting for a restock
        </p>
        {data.waiting.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No one yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.waiting.slice(0, 6).map((w) => (
              <li key={w.productId} className="flex items-center justify-between gap-2">
                <span className="truncate">{w.title}</span>
                {can("customers.view") ? (
                  <button type="button" className="shrink-0 text-xs font-medium text-violet-300 hover:underline" onClick={() => void showContacts(w.productId, w.title)}>
                    {w.waiting} waiting
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-violet-300">{w.waiting} waiting</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">They get a text (or email) when you add stock — oldest first, never between 9 PM and 8 AM.</p>
      </Card>

      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Heart className="h-4 w-4 text-rose-400" /> Most saved
        </p>
        {data.mostSaved.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No saves yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.mostSaved.slice(0, 6).map((m) => (
              <li key={m.productId} className="flex justify-between gap-2">
                <span className="truncate">{m.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{m.saves} saved</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Buyers tap the heart on your shop. Good items to restock or feature.</p>
      </Card>

      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-amber-400" /> Pre-orders to ship
        </p>
        {data.preorders.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">None open.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.preorders.slice(0, 6).map((p) => (
              <li key={p.productId} className="flex justify-between gap-2">
                <span className="truncate">{p.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.units} pcs · {p.orders} order{p.orders === 1 ? "" : "s"}
                  {p.shipDate ? ` · ~${p.shipDate}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Pre-orders don&apos;t take stock — set these aside when the goods arrive.</p>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Waiting for {open.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Oldest first. Use these only to tell them it&apos;s back.</p>
            {!open.contacts ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto text-sm">
                {open.contacts.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>{c.phone ?? c.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.variantTitle ? `${c.variantTitle} · ` : ""}
                      {new Date(c.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
