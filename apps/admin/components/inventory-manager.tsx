"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Search, Upload, X } from "lucide-react";
import { Button, Card } from "@gumakart/ui";
import { useShopRole } from "@/lib/use-shop-role";
import { DemandPanel } from "@/components/demand-panel";

/**
 * Phase 9 — Stock page. One row per sellable item (product, or each size/colour).
 * - Count: type what's on the shelf; saving replaces the system number and logs
 *   the difference in the stock history.
 * - CSV: export, edit price/stock in Excel or Sheets, import (preview first).
 * - Low-stock threshold: drives the dashboard alert and the "Low" filter.
 */

interface Row {
  productId: string;
  productTitle: string;
  productSlug: string;
  productStatus: string;
  hasOptions: boolean;
  variantId: string;
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  price: string;
  /** Phase 14: cost per unit (hidden from staff). */
  costPrice?: string | null;
  stockQty: number;
}

interface ImportPlan {
  applied: boolean;
  changes: Array<{ line: number; label: string; fromStock: number; fromPrice: string; stockQty?: number; price?: number; costPrice?: number | null; fromCost?: string | null }>;
  skipped: Array<{ line: number; reason: string }>;
  changed?: number;
}

type Filter = "all" | "low" | "out";

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\.00$/, "");

export function InventoryManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [threshold, setThreshold] = useState(3);
  const [thresholdDraft, setThresholdDraft] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const role = useShopRole();
  const canAdjust = role.can("stock.adjust");
  // Phase 14: cost prices (profit reports) — managers and owners.
  const canCost = role.can("products.edit");
  const [costSaving, setCostSaving] = useState<string | null>(null);
  async function saveCost(variantId: string, value: string) {
    const v = value.trim() === "" ? null : Number(value.replace(/[₱,\s]/g, ""));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    setCostSaving(variantId);
    const res = await fetch("/api/inventory/cost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId, costPrice: v }) });
    setCostSaving(null);
    if (res.ok) setRows((list) => (list ?? []).map((r) => (r.variantId === variantId ? { ...r, costPrice: v === null ? null : v.toFixed(2) } : r)));
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; error?: string; rows?: Row[]; threshold?: number; waiting?: Record<string, number> };
      if (!data.ok) throw new Error(data.error ?? "Could not load stock.");
      setRows(data.rows ?? []);
      setWaiting(data.waiting ?? {});
      setThreshold(data.threshold ?? 3);
      setThresholdDraft(String(data.threshold ?? 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load stock.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get("filter") === "low") setFilter("low");
  }, [load]);

  const lowCount = useMemo(() => (rows ?? []).filter((r) => r.stockQty <= threshold).length, [rows, threshold]);
  const outCount = useMemo(() => (rows ?? []).filter((r) => r.stockQty <= 0).length, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "low" && r.stockQty > threshold) return false;
      if (filter === "out" && r.stockQty > 0) return false;
      if (!q) return true;
      return (
        r.productTitle.toLowerCase().includes(q) ||
        (r.variantTitle ?? "").toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase() === q ||
        (r.barcode ?? "").toLowerCase() === q
      );
    });
  }, [rows, filter, query, threshold]);

  const pending = useMemo(
    () =>
      Object.entries(counts)
        .filter(([id, v]) => v.trim() !== "" && Number(v) !== rows?.find((r) => r.variantId === id)?.stockQty)
        .map(([variantId, v]) => ({ variantId, stockQty: Number(v) })),
    [counts, rows]
  );
  const invalid = pending.some((p) => !Number.isInteger(p.stockQty) || p.stockQty < 0);

  async function saveCount() {
    if (pending.length === 0 || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes: pending }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; changed?: number };
      if (!data.ok) throw new Error(data.error ?? "Could not save.");
      setCounts({});
      setNotice(`Saved — ${data.changed ?? 0} item${data.changed === 1 ? "" : "s"} updated. The differences are in each product's stock history.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function saveThreshold() {
    const n = Number(thresholdDraft);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setError("Low-stock alert must be a whole number from 0 to 1000.");
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { inventory: { lowStockThreshold: n } } }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) {
      setError(data.error ?? "Could not save the alert level.");
      return;
    }
    setThreshold(n);
    setNotice(`Low-stock alert set to ${n} or fewer.`);
  }

  async function runImport(text: string, apply: boolean) {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: text, apply }),
      });
      const data = (await res.json()) as ImportPlan & { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not read the file.");
      if (apply) {
        setPlan(null);
        setCsvText(null);
        setNotice(`Imported — ${data.changed ?? 0} item${data.changed === 1 ? "" : "s"} updated.`);
        await load();
      } else {
        setPlan(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setImporting(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("The file is too big (1 MB max).");
      return;
    }
    const text = await file.text();
    setCsvText(text);
    await runImport(text, false);
  }

  return (
    <div className="space-y-4">
      <DemandPanel />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Count what&apos;s on the shelf, or update many items at once with a spreadsheet.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/inventory/export"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.05]"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
          {canAdjust && <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.05]"
          >
            <Upload className="h-4 w-4" /> Import CSV
          </button>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e)} />
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm text-red-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {plan && (
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Import preview</p>
              <p className="text-sm text-slate-400">
                {plan.changes.length} item{plan.changes.length === 1 ? "" : "s"} will change
                {plan.skipped.length ? ` · ${plan.skipped.length} row${plan.skipped.length === 1 ? "" : "s"} skipped` : ""}. Nothing
                is saved until you confirm.
              </p>
            </div>
            <button type="button" onClick={() => setPlan(null)} className="text-slate-400 hover:text-white" aria-label="Cancel import">
              <X className="h-5 w-5" />
            </button>
          </div>
          {plan.changes.length > 0 && (
            <ul className="max-h-64 divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/10 text-sm">
              {plan.changes.map((c) => (
                <li key={c.line} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-slate-300">
                    {c.stockQty !== undefined ? `Stock ${c.fromStock} → ${c.stockQty}` : ""}
                    {c.stockQty !== undefined && c.price !== undefined ? " · " : ""}
                    {c.price !== undefined ? `Price ${peso(Number(c.fromPrice))} → ${peso(c.price)}` : ""}
                    {c.costPrice != null ? `${c.stockQty !== undefined || c.price !== undefined ? " · " : ""}Cost ${c.fromCost != null ? peso(Number(c.fromCost)) : "—"} → ${peso(c.costPrice)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plan.skipped.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-200">
              {plan.skipped.slice(0, 20).map((s) => (
                <li key={s.line}>
                  Row {s.line}: {s.reason}
                </li>
              ))}
              {plan.skipped.length > 20 && <li>…and {plan.skipped.length - 20} more.</li>}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={importing || plan.changes.length === 0 || !csvText}
              onClick={() => csvText && void runImport(csvText, true)}
            >
              {importing ? "Saving…" : `Update ${plan.changes.length} item${plan.changes.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `All (${rows?.length ?? 0})`],
            ["low", `Low (${lowCount})`],
            ["out", `Sold out (${outCount})`],
          ] as Array<[Filter, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              filter === id ? "border-primary/60 bg-primary/15 text-white" : "border-white/10 text-slate-300 hover:bg-white/[0.05]"
            }`}
          >
            {label}
          </button>
        ))}
        <Link
          href="/inventory/branches"
          className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/[0.05]"
        >
          By branch →
        </Link>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, or scan a barcode"
            aria-label="Search stock"
            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm outline-none focus:border-primary/40"
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {rows === null ? (
          <p className="flex items-center gap-2 p-5 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading stock…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">
            No stock-tracked products yet.{" "}
            <Link href="/products" className="text-primary underline">
              Add products
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 font-medium">Price</th>
                  {canCost && <th className="px-4 py-2.5 font-medium">Cost</th>}
                  <th className="px-4 py-2.5 text-right font-medium">In system</th>
                  <th className="px-4 py-2.5 font-medium">Counted</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const draft = counts[r.variantId] ?? "";
                  const diff = draft.trim() !== "" ? Number(draft) - r.stockQty : 0;
                  return (
                    <tr key={r.variantId} className="border-t border-white/[0.06]" data-testid="stock-row">
                      <td className="px-4 py-2">
                        <span className="font-medium text-slate-100">{r.productTitle}</span>
                        {r.variantTitle ? <span className="text-slate-400"> · {r.variantTitle}</span> : null}
                        {r.productStatus !== "active" ? <span className="ml-2 text-xs text-slate-500">(draft)</span> : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400">{r.sku ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-300">{peso(Number(r.price))}</td>
                      {canCost && (
                        <td className="px-4 py-1.5">
                          <input
                            key={`${r.variantId}:${r.costPrice ?? ""}`}
                            defaultValue={r.costPrice != null ? Number(r.costPrice).toFixed(2) : ""}
                            onBlur={(e) => {
                              const before = r.costPrice != null ? Number(r.costPrice).toFixed(2) : "";
                              if (e.target.value.trim() !== before) void saveCost(r.variantId, e.target.value);
                            }}
                            inputMode="decimal"
                            placeholder="₱ —"
                            aria-label={`Cost of ${r.productTitle}${r.variantTitle ? ` ${r.variantTitle}` : ""}`}
                            className={`h-9 w-24 rounded-lg border border-border bg-card px-2 ${costSaving === r.variantId ? "opacity-50" : ""}`}
                            data-testid="cost-input"
                          />
                        </td>
                      )}
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          r.stockQty <= 0 ? "text-red-300" : r.stockQty <= threshold ? "text-amber-300" : "text-slate-100"
                        }`}
                      >
                        {r.stockQty}
                        {waiting[r.variantId] ? (
                          <span className="block text-[11px] font-medium text-violet-300" data-testid="waiting-count">
                            {waiting[r.variantId]} waiting
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            value={draft}
                            onChange={(e) => setCounts((c) => ({ ...c, [r.variantId]: e.target.value }))}
                            type="number"
                            min="0"
                            inputMode="numeric"
                            placeholder={String(r.stockQty)}
                            disabled={!canAdjust}
                            aria-label={`Counted stock for ${r.productTitle}${r.variantTitle ? ` ${r.variantTitle}` : ""}`}
                            className="h-9 w-24 rounded-lg border border-border bg-card px-2"
                          />
                          {diff !== 0 && Number.isFinite(diff) ? (
                            <span className={`text-xs font-semibold ${diff > 0 ? "text-emerald-300" : "text-red-300"}`}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canAdjust && <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0A0F1D]/95 px-4 py-3 backdrop-blur">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Low-stock alert at
          <input
            value={thresholdDraft}
            onChange={(e) => setThresholdDraft(e.target.value)}
            type="number"
            min="0"
            className="h-9 w-16 rounded-lg border border-border bg-card px-2"
            aria-label="Low-stock alert level"
          />
          or fewer
          {Number(thresholdDraft) !== threshold && (
            <button type="button" onClick={() => void saveThreshold()} className="text-primary hover:underline">
              Save
            </button>
          )}
        </label>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <button type="button" className="text-sm text-slate-400 hover:text-white" onClick={() => setCounts({})}>
              Clear
            </button>
          )}
          <Button type="button" disabled={saving || pending.length === 0 || invalid} onClick={() => void saveCount()}>
            {saving ? "Saving…" : pending.length ? `Save count (${pending.length})` : "Save count"}
          </Button>
        </div>
      </div>}
    </div>
  );
}
