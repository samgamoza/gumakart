"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button, Card, formatPrice } from "@gumakart/ui";

/**
 * Phase 14 — Discounts: quantity deals ("Buy 3, 10% off"), coupon codes (schedule, limits,
 * one per buyer) and the automatic order discount. Saved straight to checkout — online
 * store and checkout links use them right away; the server recomputes every total.
 */

type Kind = "percent" | "fixed";

interface Coupon {
  code: string;
  type: Kind;
  value: number;
  minSubtotal?: number | null;
  maxRedemptions?: number | null;
  oncePerBuyer?: boolean;
  active?: boolean;
  note?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface Deal {
  id?: string;
  label: string;
  productIds: string[];
  minQty: number;
  type: Kind;
  value: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface Auto {
  type: Kind;
  value: number;
  minSubtotal?: number | null;
  label?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface Usage {
  code: string;
  orders: number;
  sales: number;
  discount: number;
}

const OFFSET = 8 * 3_600_000;
/** Stored ISO → YYYY-MM-DD in Manila (end dates are exclusive, so show the day before). */
const toDay = (iso: string | null | undefined, end = false) =>
  iso ? new Date(Date.parse(iso) + OFFSET - (end ? 1 : 0)).toISOString().slice(0, 10) : "";
const fromDay = (day: string, end = false) => (day ? new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET + (end ? 86_400_000 : 0)).toISOString() : null);

function Schedule({ value, onChange }: { value: { startsAt?: string | null; endsAt?: string | null }; onChange: (v: { startsAt: string | null; endsAt: string | null }) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      From
      <input type="date" className="guma-field h-8 w-36 text-xs" value={toDay(value.startsAt)} onChange={(e) => onChange({ startsAt: fromDay(e.target.value), endsAt: value.endsAt ?? null })} aria-label="Starts" />
      to
      <input type="date" className="guma-field h-8 w-36 text-xs" value={toDay(value.endsAt, true)} onChange={(e) => onChange({ startsAt: value.startsAt ?? null, endsAt: fromDay(e.target.value, true) })} aria-label="Ends" />
      <span>(blank = always)</span>
    </span>
  );
}

function KindValue({ type, value, onChange }: { type: Kind; value: number; onChange: (t: Kind, v: number) => void }) {
  return (
    <span className="flex items-center gap-1">
      <input type="number" min="0" step="1" className="guma-field h-9 w-24" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(type, Number(e.target.value))} aria-label="Amount" />
      <select className="guma-field h-9 w-28" value={type} onChange={(e) => onChange(e.target.value as Kind, value)} aria-label="Kind">
        <option value="percent">% off</option>
        <option value="fixed">₱ off</option>
      </select>
    </span>
  );
}

export function DiscountsView() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/discounts", { cache: "no-store" });
    const d = (await res.json()) as { ok: boolean; coupons: Coupon[]; volumeDiscounts: Deal[]; automaticDiscount: Auto | null; usage: Usage[]; error?: string };
    if (!d.ok) return setMsg({ text: d.error ?? "Could not load.", ok: false });
    setCoupons(d.coupons);
    setDeals(d.volumeDiscounts);
    setAuto(d.automaticDiscount);
    setUsage(d.usage);
    setDirty(false);
  }, []);
  useEffect(() => {
    void load();
    void fetch("/api/pos/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; products?: Array<{ id: string; title: string }> }) => d.ok && setProducts((d.products ?? []).map((p) => ({ id: p.id, title: p.title }))));
  }, [load]);

  const edit = <T,>(set: (fn: (v: T) => T) => void) => (fn: (v: T) => T) => {
    set(fn);
    setDirty(true);
    setMsg(null);
  };
  const editCoupons = edit<Coupon[] | null>(setCoupons);
  const editDeals = edit<Deal[]>(setDeals);
  const editAuto = edit<Auto | null>(setAuto);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/discounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coupons: coupons ?? [], volumeDiscounts: deals, automaticDiscount: auto }),
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not save.", ok: false });
    setMsg({ text: "Saved — live on your store and checkout links now.", ok: true });
    await load();
  }

  if (!coupons) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <p className="text-sm text-muted-foreground">
        Deals apply by themselves to the items they cover; then one coupon <em>or</em> the automatic discount comes off the rest. Free delivery over an amount is set in{" "}
        <Link href="/settings/delivery-shipping" className="text-violet-300 underline">
          Delivery
        </Link>
        . POS sales use their own Senior/PWD discounts.
      </p>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Quantity deals</h2>
            <p className="text-xs text-muted-foreground">&ldquo;Buy 3 shirts, 10% off&rdquo; or &ldquo;Any 2 items, ₱20 off each&rdquo;. No code needed.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => editDeals((d) => [...d, { label: "Buy 2, 10% off", productIds: [], minQty: 2, type: "percent", value: 10, active: true }])}
            data-testid="add-deal"
          >
            <Plus className="h-4 w-4" /> Deal
          </Button>
        </div>
        {deals.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No deals yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {deals.map((deal, i) => {
              const set = (patch: Partial<Deal>) => editDeals((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={deal.id ?? `new-${i}`} className="space-y-2 rounded-xl border border-white/10 p-3" data-testid="deal-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="guma-field h-9 min-w-0 flex-1 basis-48" value={deal.label} onChange={(e) => set({ label: e.target.value })} aria-label="Deal name (shown at checkout)" placeholder="Shown at checkout" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={deal.active !== false} onChange={(e) => set({ active: e.target.checked })} /> On
                    </label>
                    <button type="button" aria-label="Delete deal" className="rounded-lg p-1.5 text-muted-foreground hover:text-red-300" onClick={() => editDeals((list) => list.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    Buy
                    <input type="number" min="2" className="guma-field h-9 w-20" value={deal.minQty} onChange={(e) => set({ minQty: Math.max(2, Math.trunc(Number(e.target.value) || 2)) })} aria-label="Minimum quantity" />
                    or more of
                    <select
                      className="guma-field h-9 w-56"
                      value={deal.productIds.length === 0 ? "" : deal.productIds.length === 1 ? deal.productIds[0] : "__many"}
                      onChange={(e) => set({ productIds: e.target.value === "" ? [] : e.target.value === "__many" ? deal.productIds : [e.target.value] })}
                      aria-label="Products"
                    >
                      <option value="">any products</option>
                      {deal.productIds.length > 1 && <option value="__many">{deal.productIds.length} products</option>}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    → <KindValue type={deal.type} value={deal.value} onChange={(type, value) => set({ type, value })} />
                    <span className="text-xs text-muted-foreground">{deal.type === "fixed" ? "per item" : "on those items"}</span>
                  </div>
                  <Schedule value={deal} onChange={(v) => set(v)} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Coupon codes</h2>
            <p className="text-xs text-muted-foreground">Share a code in your posts, or attach it to a checkout link.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => editCoupons((c) => [...(c ?? []), { code: "", type: "percent", value: 10, active: true }])} data-testid="add-coupon">
            <Plus className="h-4 w-4" /> Coupon
          </Button>
        </div>
        {coupons.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No coupons yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {coupons.map((c, i) => {
              const set = (patch: Partial<Coupon>) => editCoupons((list) => (list ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const used = usage.find((u) => u.code === c.code.toUpperCase());
              return (
                <li key={`c-${i}`} className="space-y-2 rounded-xl border border-white/10 p-3" data-testid="coupon-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="guma-field h-9 w-40 font-mono uppercase" value={c.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} placeholder="PAYDAY10" aria-label="Code" />
                    <KindValue type={c.type} value={c.value} onChange={(type, value) => set({ type, value })} />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={c.active !== false} onChange={(e) => set({ active: e.target.checked })} /> On
                    </label>
                    <span className="ml-auto text-xs text-muted-foreground">{used ? `${used.orders} used · ${formatPrice(used.sales)} sales` : "Not used yet"}</span>
                    <button type="button" aria-label="Delete coupon" className="rounded-lg p-1.5 text-muted-foreground hover:text-red-300" onClick={() => editCoupons((list) => (list ?? []).filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1">
                      Min order ₱
                      <input type="number" min="0" className="guma-field h-8 w-24" value={c.minSubtotal ?? ""} onChange={(e) => set({ minSubtotal: e.target.value === "" ? null : Number(e.target.value) })} />
                    </label>
                    <label className="flex items-center gap-1">
                      Max uses
                      <input type="number" min="1" className="guma-field h-8 w-20" value={c.maxRedemptions ?? ""} onChange={(e) => set({ maxRedemptions: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) })} />
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={c.oncePerBuyer === true} onChange={(e) => set({ oncePerBuyer: e.target.checked })} /> Once per buyer
                    </label>
                  </div>
                  <Schedule value={c} onChange={(v) => set(v)} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Automatic order discount</h2>
            <p className="text-xs text-muted-foreground">Comes off every order over an amount, unless the buyer uses a coupon.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto !== null} onChange={(e) => editAuto(() => (e.target.checked ? { type: "percent", value: 5, minSubtotal: 1000, label: "Sale" } : null))} /> On
          </label>
        </div>
        {auto && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <KindValue type={auto.type} value={auto.value} onChange={(type, value) => editAuto((a) => (a ? { ...a, type, value } : a))} />
              on orders over ₱
              <input type="number" min="0" className="guma-field h-9 w-28" value={auto.minSubtotal ?? ""} onChange={(e) => editAuto((a) => (a ? { ...a, minSubtotal: e.target.value === "" ? null : Number(e.target.value) } : a))} aria-label="Minimum order" />
              <input className="guma-field h-9 w-48" value={auto.label ?? ""} placeholder="Label (e.g. 9.9 Sale)" onChange={(e) => editAuto((a) => (a ? { ...a, label: e.target.value } : a))} aria-label="Label" />
            </div>
            <Schedule value={auto} onChange={(v) => editAuto((a) => (a ? { ...a, ...v } : a))} />
          </div>
        )}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0A0F1D]/95 p-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <p className={`text-sm ${msg ? (msg.ok ? "text-emerald-300" : "text-red-300") : "text-muted-foreground"}`} data-testid="discounts-msg">
            {msg?.text ?? (dirty ? "Unsaved changes" : "All saved")}
          </p>
          <Button type="button" disabled={busy || !dirty} onClick={() => void save()} data-testid="discounts-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save discounts
          </Button>
        </div>
      </div>
    </div>
  );
}
