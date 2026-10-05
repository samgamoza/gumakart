"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Printer, Trash2, X } from "lucide-react";
import { Button } from "@gumakart/ui";
import { useShopRole } from "@/lib/use-shop-role";

/**
 * Phase 11 — everything after the sale for one order: seller notes & tags, editing items
 * before packing, returns/exchanges/partial refunds after delivery, history, packing slip.
 * The server decides what's allowed (canEdit / canReturn + the role); this only mirrors it.
 */

interface Line {
  orderItemId: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  quantity: number;
  returnedQty: number;
  unitPrice: number;
}

interface HistoryRow {
  id: string;
  kind: string;
  items: Array<{ title: string; qty: number; replacementTitle?: string | null; restock: boolean }>;
  refundAmount: number;
  collectedAmount: number;
  refundMethod: string;
  note: string | null;
  actorName: string;
  createdAt: string;
}

interface View {
  orderId: string;
  orderNumber: string;
  sourceChannel: string | null;
  paymentState: string;
  total: number;
  refunded: number;
  refundable: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  staffNote: string | null;
  tags: string[];
  canEdit: boolean;
  editBlockedReason: string | null;
  canReturn: boolean;
  returnBlockedReason: string | null;
  paidOnline: boolean;
  lines: Line[];
  history: HistoryRow[];
}

interface ProductOpt {
  id: string;
  title: string;
  basePrice: string;
  status: string;
  hasOptions?: boolean;
}

interface VariantOpt {
  id: string;
  title: string;
  price: string;
  stockQty: number;
}

type Tab = "notes" | "edit" | "return" | "history";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD_LABEL: Record<string, string> = {
  original: "Back to how they paid (online)",
  cash: "Cash",
  gcash: "GCash",
  maya: "Maya",
  bank: "Bank transfer",
  card: "Card",
  shop: "Shop returns it",
  none: "—",
};
const KIND_LABEL: Record<string, string> = { edit: "Edited", return: "Return", exchange: "Exchange", void: "Voided" };

async function json<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return (await res.json().catch(() => ({ ok: false, error: "Something went wrong." }))) as T & { ok: boolean; error?: string };
}

export function OrderTools({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: (msg: string) => void }) {
  const perms = useShopRole();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("notes");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await json<{ view: View }>(`/api/orders/${orderId}/after-sale`);
    if (!data.ok) {
      setError(data.error ?? "Could not load the order.");
      return;
    }
    setView(data.view);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "notes", label: "Notes & tags", show: true },
    { id: "edit", label: "Edit items", show: perms.can("orders.edit") && view?.sourceChannel !== "pos" },
    { id: "return", label: "Return / refund", show: perms.can("orders.refund") },
    { id: "history", label: `History${view?.history.length ? ` (${view.history.length})` : ""}`, show: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Order tools">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="font-display text-lg font-bold">{view?.orderNumber ?? "Order"}</p>
            {view && (
              <p className="text-xs text-muted-foreground">
                Total {peso(view.total)}
                {view.refunded > 0 ? ` · refunded ${peso(view.refunded)}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/orders/slips?ids=${orderId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <Printer className="h-3.5 w-3.5" /> Packing slip
            </a>
            <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.id ? "border-emerald-600 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {!view ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : tab === "notes" ? (
            <NotesTab view={view} saving={saving} setSaving={setSaving} setError={setError} onSaved={(m) => { onChanged(m); void load(); }} />
          ) : tab === "edit" ? (
            <EditTab view={view} saving={saving} setSaving={setSaving} setError={setError} onSaved={(m) => { onChanged(m); void load(); }} />
          ) : tab === "return" ? (
            <ReturnTab view={view} saving={saving} setSaving={setSaving} setError={setError} onSaved={(m) => { onChanged(m); void load(); setTab("history"); }} />
          ) : (
            <HistoryTab view={view} />
          )}
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  view: View;
  saving: boolean;
  setSaving: (v: boolean) => void;
  setError: (e: string | null) => void;
  onSaved: (msg: string) => void;
}

function NotesTab({ view, saving, setSaving, setError, onSaved }: TabProps) {
  const [note, setNote] = useState(view.staffNote ?? "");
  const [tags, setTags] = useState<string[]>(view.tags);
  const [draft, setDraft] = useState("");
  const [suggest, setSuggest] = useState<string[]>([]);
  useEffect(() => {
    void json<{ tags: string[] }>("/api/orders/tags").then((d) => d.ok && setSuggest(d.tags));
  }, []);
  const add = (t: string) => {
    const tag = t.trim().slice(0, 24);
    if (tag && !tags.some((x) => x.toLowerCase() === tag.toLowerCase()) && tags.length < 10) setTags([...tags, tag]);
    setDraft("");
  };
  async function save() {
    setSaving(true);
    setError(null);
    const d = await json(`/api/orders/${view.orderId}/notes`, { method: "PATCH", body: JSON.stringify({ staffNote: note, tags }) });
    setSaving(false);
    if (!d.ok) return setError(d.error ?? "Could not save.");
    onSaved(`Saved notes for ${view.orderNumber}.`);
  }
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Note for your team</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Gift wrap. Buyer asked for the blue box. Call before 5pm."
        />
        <span className="text-xs text-muted-foreground">Only your team sees this — never the buyer.</span>
      </label>
      <div>
        <span className="mb-1 block text-sm font-medium">Tags</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            className="h-8 w-36 rounded-lg border border-dashed border-border bg-background px-2 text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              }
            }}
            placeholder="Add tag (VIP, Rush…)"
            aria-label="Add tag"
          />
        </div>
        {suggest.filter((s) => !tags.includes(s)).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {suggest
              .filter((s) => !tags.includes(s))
              .slice(0, 8)
              .map((s) => (
                <button key={s} type="button" onClick={() => add(s)} className="rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border hover:bg-muted">
                  + {s}
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function EditTab({ view, saving, setSaving, setError, onSaved }: TabProps) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(view.lines.map((l) => [l.orderItemId, l.quantity])));
  const [added, setAdded] = useState<Array<{ key: string; productId: string; variantId: string | null; title: string; price: number; qty: number }>>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [pick, setPick] = useState("");
  const [variants, setVariants] = useState<VariantOpt[] | null>(null);
  const [variantPick, setVariantPick] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!view.canEdit) return;
    void json<{ products: ProductOpt[] }>("/api/products").then((d) => d.ok && setProducts(d.products.filter((p) => p.status === "active")));
  }, [view.canEdit]);

  useEffect(() => {
    setVariants(null);
    setVariantPick("");
    const p = products.find((x) => x.id === pick);
    if (p?.hasOptions) {
      void json<{ variants: VariantOpt[] }>(`/api/products/${p.id}/variants`).then((d) => d.ok && setVariants(d.variants));
    }
  }, [pick, products]);

  const newSubtotal = useMemo(
    () => view.lines.reduce((n, l) => n + l.unitPrice * (qty[l.orderItemId] ?? l.quantity), 0) + added.reduce((n, a) => n + a.price * a.qty, 0),
    [view.lines, qty, added]
  );
  const estTotal = Math.max(0, newSubtotal - Math.min(view.discount, newSubtotal)) + view.deliveryFee;
  const paid = view.paymentState === "paid";

  if (!view.canEdit) return <p className="text-sm text-muted-foreground">{view.editBlockedReason}</p>;

  function addItem() {
    const p = products.find((x) => x.id === pick);
    if (!p) return;
    const v = variants?.find((x) => x.id === variantPick) ?? null;
    if (p.hasOptions && !v) return setError("Pick a size or option.");
    setError(null);
    setAdded([...added, { key: `${p.id}:${v?.id ?? ""}:${Date.now()}`, productId: p.id, variantId: v?.id ?? null, title: v ? `${p.title} (${v.title})` : p.title, price: Number(v?.price ?? p.basePrice), qty: 1 }]);
    setPick("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    const lines = [
      ...view.lines.filter((l) => (qty[l.orderItemId] ?? l.quantity) !== l.quantity).map((l) => ({ orderItemId: l.orderItemId, qty: qty[l.orderItemId] ?? 0 })),
      ...added.filter((a) => a.qty > 0).map((a) => ({ productId: a.productId, variantId: a.variantId, qty: a.qty })),
    ];
    if (lines.length === 0) {
      setSaving(false);
      return setError("Nothing changed.");
    }
    const d = await json<{ result: { summary: string; refundDue: number; refundedAtGateway: boolean } }>(`/api/orders/${view.orderId}/edit`, {
      method: "POST",
      body: JSON.stringify({ lines, note: note || null }),
    });
    setSaving(false);
    if (!d.ok) return setError(d.error ?? "Could not save.");
    setAdded([]);
    onSaved(
      d.result.refundDue > 0
        ? `${view.orderNumber} updated. ${d.result.refundedAtGateway ? `${peso(d.result.refundDue)} is being refunded online.` : `Give back ${peso(d.result.refundDue)} to the buyer.`}`
        : `${view.orderNumber} updated.`
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {view.lines.map((l) => {
          const q = qty[l.orderItemId] ?? l.quantity;
          return (
            <li key={l.orderItemId} className={`flex items-center gap-3 px-3 py-2.5 ${q === 0 ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.title}</p>
                <p className="text-xs text-muted-foreground">{peso(l.unitPrice)} each</p>
              </div>
              <Stepper value={q} onChange={(v) => setQty({ ...qty, [l.orderItemId]: v })} max={paid ? l.quantity : 999} />
              <button type="button" aria-label={`Remove ${l.title}`} className="p-1 text-muted-foreground hover:text-red-600" onClick={() => setQty({ ...qty, [l.orderItemId]: 0 })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {added.map((a) => (
          <li key={a.key} className="flex items-center gap-3 bg-emerald-500/10 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.title} <span className="text-xs font-normal text-emerald-700">new</span></p>
              <p className="text-xs text-muted-foreground">{peso(a.price)} each</p>
            </div>
            <Stepper value={a.qty} onChange={(v) => setAdded(added.map((x) => (x.key === a.key ? { ...x, qty: v } : x)))} max={999} />
            <button type="button" aria-label={`Remove ${a.title}`} className="p-1 text-muted-foreground hover:text-red-600" onClick={() => setAdded(added.filter((x) => x.key !== a.key))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {!paid && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a product">
            <option value="">Add a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {variants && (
            <select className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={variantPick} onChange={(e) => setVariantPick(e.target.value)} aria-label="Size or option">
              <option value="">Size…</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.stockQty <= 0}>
                  {v.title} · {peso(Number(v.price))}
                  {v.stockQty <= 0 ? " · sold out" : ""}
                </option>
              ))}
            </select>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!pick}>
            Add
          </Button>
        </div>
      )}
      {paid && <p className="text-xs text-muted-foreground">The buyer already paid, so you can only lower quantities or remove items — the difference goes back to them.</p>}
      <input className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" placeholder="Reason (optional, e.g. buyer changed mind)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
        <span>
          New total ≈ <strong>{peso(estTotal)}</strong> <span className="text-muted-foreground">(was {peso(view.total)})</span>
        </span>
        {paid && estTotal < view.total && <span className="font-medium text-amber-700">Give back ≈ {peso(view.total - estTotal)}</span>}
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function ReturnTab({ view, saving, setSaving, setError, onSaved }: TabProps) {
  const [rows, setRows] = useState<Record<string, { qty: number; restock: boolean; swap: string }>>(() =>
    Object.fromEntries(view.lines.map((l) => [l.orderItemId, { qty: 0, restock: true, swap: "" }]))
  );
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, VariantOpt[]>>({});
  const [refund, setRefund] = useState("");
  const [touched, setTouched] = useState(false);
  const [collected, setCollected] = useState("");
  const [method, setMethod] = useState(view.paidOnline ? "original" : "cash");
  const [note, setNote] = useState("");

  const suggested = useMemo(() => {
    let n = 0;
    for (const l of view.lines) {
      const r = rows[l.orderItemId];
      if (!r || r.qty === 0) continue;
      if (r.swap) {
        const v = variantsByProduct[l.productId ?? ""]?.find((x) => x.id === r.swap);
        n += Math.max(0, l.unitPrice - Number(v?.price ?? l.unitPrice)) * r.qty;
      } else n += l.unitPrice * r.qty;
    }
    return Math.min(Math.round(n * 100) / 100, view.refundable);
  }, [rows, view.lines, view.refundable, variantsByProduct]);
  const suggestedCollect = useMemo(() => {
    let n = 0;
    for (const l of view.lines) {
      const r = rows[l.orderItemId];
      if (!r?.swap || r.qty === 0) continue;
      const v = variantsByProduct[l.productId ?? ""]?.find((x) => x.id === r.swap);
      n += Math.max(0, Number(v?.price ?? l.unitPrice) - l.unitPrice) * r.qty;
    }
    return Math.round(n * 100) / 100;
  }, [rows, view.lines, variantsByProduct]);

  useEffect(() => {
    if (!touched) setRefund(suggested ? String(suggested) : "");
  }, [suggested, touched]);
  useEffect(() => {
    setCollected(suggestedCollect ? String(suggestedCollect) : "");
  }, [suggestedCollect]);

  if (!view.canReturn) return <p className="text-sm text-muted-foreground">{view.returnBlockedReason}</p>;

  async function loadVariants(productId: string | null) {
    if (!productId || variantsByProduct[productId]) return;
    const d = await json<{ variants: VariantOpt[] }>(`/api/products/${productId}/variants`);
    if (d.ok) setVariantsByProduct((m) => ({ ...m, [productId]: d.variants }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const items = view.lines
      .filter((l) => (rows[l.orderItemId]?.qty ?? 0) > 0)
      .map((l) => ({ orderItemId: l.orderItemId, qty: rows[l.orderItemId]!.qty, restock: rows[l.orderItemId]!.restock, replacementVariantId: rows[l.orderItemId]!.swap || null }));
    const refundAmount = Number(refund || 0);
    const collectedAmount = Number(collected || 0);
    const d = await json<{ result: { summary: string; fullyRefunded: boolean } }>(`/api/orders/${view.orderId}/returns`, {
      method: "POST",
      body: JSON.stringify({ items, refundAmount, collectedAmount: refundAmount > 0 ? 0 : collectedAmount, refundMethod: refundAmount > 0 || collectedAmount > 0 ? method : "none", note: note || null }),
    });
    setSaving(false);
    if (!d.ok) return setError(d.error ?? "Could not save.");
    onSaved(`${d.result.summary}${d.result.fullyRefunded ? " — order fully refunded." : ""}`);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Pick what came back. You can refund any amount up to {peso(view.refundable)}, or swap for another size/colour.
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {view.lines.map((l) => {
          const left = l.quantity - l.returnedQty;
          const r = rows[l.orderItemId]!;
          const set = (patch: Partial<typeof r>) => setRows({ ...rows, [l.orderItemId]: { ...r, ...patch } });
          const vs = variantsByProduct[l.productId ?? ""];
          return (
            <li key={l.orderItemId} className="space-y-2 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {peso(l.unitPrice)} each · bought {l.quantity}
                    {l.returnedQty ? ` · ${l.returnedQty} already back` : ""}
                  </p>
                </div>
                {left > 0 ? <Stepper value={r.qty} onChange={(v) => set({ qty: v })} max={left} min={0} /> : <span className="text-xs text-muted-foreground">All back</span>}
              </div>
              {r.qty > 0 && (
                <div className="flex flex-wrap items-center gap-3 pl-1 text-xs">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={r.restock} onChange={(e) => set({ restock: e.target.checked })} /> Put back in stock
                  </label>
                  {l.variantId && (
                    <span className="inline-flex items-center gap-1.5">
                      Swap for
                      <select
                        className="h-8 rounded-lg border border-border bg-background px-2"
                        value={r.swap}
                        onFocus={() => void loadVariants(l.productId)}
                        onChange={(e) => set({ swap: e.target.value })}
                        aria-label={`Swap ${l.title} for`}
                      >
                        <option value="">— no swap (refund) —</option>
                        {(vs ?? []).filter((v) => v.id !== l.variantId).map((v) => (
                          <option key={v.id} value={v.id} disabled={v.stockQty < r.qty}>
                            {v.title} · {peso(Number(v.price))}
                            {v.stockQty < r.qty ? " · not enough stock" : ""}
                          </option>
                        ))}
                        {!vs && <option disabled>Loading sizes…</option>}
                      </select>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Refund amount</span>
          <input
            className="h-10 w-full rounded-lg border border-border bg-background px-3"
            type="number"
            min="0"
            step="0.01"
            max={view.refundable}
            value={refund}
            onChange={(e) => {
              setTouched(true);
              setRefund(e.target.value);
            }}
            placeholder="0"
          />
          <span className="text-xs text-muted-foreground">Up to {peso(view.refundable)}{suggested ? ` · suggested ${peso(suggested)}` : ""}</span>
        </label>
        {suggestedCollect > 0 && !Number(refund) && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Buyer pays the difference</span>
            <input className="h-10 w-full rounded-lg border border-border bg-background px-3" type="number" min="0" step="0.01" value={collected} onChange={(e) => setCollected(e.target.value)} />
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{Number(refund) > 0 ? "Money goes back by" : "Paid by"}</span>
          <select className="h-10 w-full rounded-lg border border-border bg-background px-2" value={method} onChange={(e) => setMethod(e.target.value)}>
            {(view.paidOnline ? ["original", "cash", "gcash", "maya", "bank"] : ["cash", "gcash", "maya", "bank", "card"]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" placeholder="Reason (e.g. wrong size, damaged)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      {method !== "original" && Number(refund) > 0 && (
        <p className="text-xs text-amber-700">Send {peso(Number(refund))} to the buyer yourself by {METHOD_LABEL[method]} — Guma records it.</p>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : "Record return"}
        </Button>
      </div>
    </div>
  );
}

function HistoryTab({ view }: { view: View }) {
  if (view.history.length === 0) return <p className="text-sm text-muted-foreground">No edits or returns yet.</p>;
  return (
    <ul className="space-y-3">
      {view.history.map((h) => (
        <li key={h.id} className="rounded-xl border border-border px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{KIND_LABEL[h.kind] ?? h.kind}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(h.createdAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {h.actorName}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {h.items.map((i) => `${i.qty > 0 && h.kind === "edit" ? "+" : ""}${i.qty}× ${i.title}${i.replacementTitle ? ` → ${i.replacementTitle}` : ""}`).join(", ")}
          </p>
          {(h.refundAmount > 0 || h.collectedAmount > 0) && (
            <p className="mt-1 text-xs">
              {h.refundAmount > 0 ? `Refunded ${peso(h.refundAmount)} · ${METHOD_LABEL[h.refundMethod] ?? h.refundMethod}` : `Collected ${peso(h.collectedAmount)} · ${METHOD_LABEL[h.refundMethod] ?? h.refundMethod}`}
            </p>
          )}
          {h.note && <p className="mt-1 text-xs italic text-muted-foreground">“{h.note}”</p>}
        </li>
      ))}
    </ul>
  );
}

function Stepper({ value, onChange, max, min = 0 }: { value: number; onChange: (v: number) => void; max: number; min?: number }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-30" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Less">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-6 text-center text-sm font-semibold">{value}</span>
      <button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-30" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
