"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@gumakart/ui";

/**
 * Phase 9 — "Sizes & colours" editor. The seller lists options (Size: S, M, L;
 * Color: Red, Black) and gets one row per combination with its own price,
 * stock, SKU and barcode. Rows that disappear when an option value is removed
 * are turned off on save (past orders keep pointing at them).
 */

interface Option {
  name: string;
  values: string[];
}

interface Row {
  id: string | null;
  options: Record<string, string>;
  price: string;
  compareAtPrice: string;
  stockQty: string;
  sku: string;
  barcode: string;
  imageUrl: string | null;
}

interface ApiVariant {
  id: string;
  options: Record<string, string>;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  barcode: string | null;
  stockQty: number;
  imageUrl: string | null;
}

const MAX_OPTIONS = 3;
const MAX_VALUES = 20;
const MAX_VARIANTS = 100;
const SUGGESTED = ["Size", "Color", "Flavor", "Style"];

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const comboKey = (options: Option[], values: Record<string, string>) =>
  options.map((o) => (values[o.name] ?? "").toLowerCase()).join("\u0000");

function combinations(options: Option[]): Array<Record<string, string>> {
  let combos: Array<Record<string, string>> = [{}];
  for (const option of options) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) for (const value of option.values) next.push({ ...combo, [option.name]: value });
    combos = next;
  }
  return combos;
}

function toRow(v: ApiVariant): Row {
  return {
    id: v.id,
    options: v.options ?? {},
    price: String(Number(v.price)),
    compareAtPrice: v.compareAtPrice ? String(Number(v.compareAtPrice)) : "",
    stockQty: String(v.stockQty ?? 0),
    sku: v.sku ?? "",
    barcode: v.barcode ?? "",
    imageUrl: v.imageUrl,
  };
}

export function ProductVariantsEditor({
  productId,
  productTitle,
  onClose,
  onSaved,
}: {
  productId: string;
  productTitle: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  // Value being typed per option row (added on Enter / comma / "Add").
  const [pending, setPending] = useState<string[]>([]);
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}/variants`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; options?: Option[]; variants?: ApiVariant[] };
        if (cancelled) return;
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not load variants.");
        setOptions(data.options ?? []);
        setPending((data.options ?? []).map(() => ""));
        setRows((data.variants ?? []).map(toRow));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load variants.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  /** Usable options: named, with at least one value. */
  const liveOptions = useMemo(
    () => options.map((o) => ({ name: clean(o.name), values: o.values })).filter((o) => o.name && o.values.length > 0),
    [options]
  );

  /** Rebuild the row list from the options, keeping what the seller typed for surviving combos. */
  function regenerate(nextOptions: Option[]) {
    const usable = nextOptions.map((o) => ({ name: clean(o.name), values: o.values })).filter((o) => o.name && o.values.length > 0);
    setRows((current) => {
      const template = current[0];
      if (usable.length === 0) {
        // Back to a simple product: keep the first row's id/price/stock.
        const keep = current[0];
        return keep ? [{ ...keep, options: {} }] : [];
      }
      const byKey = new Map(current.map((r) => [comboKey(usable, r.options), r]));
      // When the first option is added, the old single "Default" row becomes the first combination.
      const unclaimed = current.filter((r) => Object.keys(r.options).length === 0);
      return combinations(usable)
        .slice(0, MAX_VARIANTS)
        .map((combo, i) => {
          const existing = byKey.get(comboKey(usable, combo));
          if (existing && Object.keys(existing.options).length > 0) return { ...existing, options: combo };
          const reuse = i === 0 ? unclaimed[0] : undefined;
          return {
            id: reuse?.id ?? null,
            options: combo,
            price: reuse?.price ?? template?.price ?? "",
            compareAtPrice: reuse?.compareAtPrice ?? "",
            stockQty: reuse?.stockQty ?? "0",
            sku: reuse?.sku ?? "",
            barcode: reuse?.barcode ?? "",
            imageUrl: reuse?.imageUrl ?? template?.imageUrl ?? null,
          };
        });
    });
  }

  function updateOptions(next: Option[]) {
    setOptions(next);
    regenerate(next);
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    const used = new Set(options.map((o) => o.name.toLowerCase()));
    const name = SUGGESTED.find((s) => !used.has(s.toLowerCase())) ?? "";
    setOptions([...options, { name, values: [] }]);
    setPending([...pending, ""]);
  }

  function removeOption(index: number) {
    updateOptions(options.filter((_, i) => i !== index));
    setPending(pending.filter((_, i) => i !== index));
  }

  function renameOption(index: number, name: string) {
    const old = options[index]!.name;
    const next = options.map((o, i) => (i === index ? { ...o, name } : o));
    setOptions(next);
    // Carry values over to the new key so rows survive a rename.
    setRows((current) =>
      current.map((r) => {
        if (!(old in r.options)) return r;
        const { [old]: value, ...rest } = r.options;
        return { ...r, options: { ...rest, [name]: value! } };
      })
    );
  }

  function addValues(index: number, raw: string) {
    const option = options[index]!;
    const incoming = raw.split(",").map(clean).filter(Boolean);
    const values = [...option.values];
    for (const v of incoming) {
      if (values.length >= MAX_VALUES) break;
      if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) values.push(v.slice(0, 40));
    }
    updateOptions(options.map((o, i) => (i === index ? { ...o, values } : o)));
    setPending(pending.map((p, i) => (i === index ? "" : p)));
  }

  function removeValue(index: number, value: string) {
    updateOptions(options.map((o, i) => (i === index ? { ...o, values: o.values.filter((v) => v !== value) } : o)));
  }

  function setRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function applyBulk() {
    setRows((current) =>
      current.map((r) => ({
        ...r,
        ...(bulkPrice.trim() ? { price: bulkPrice.trim() } : {}),
        ...(bulkStock.trim() ? { stockQty: bulkStock.trim() } : {}),
      }))
    );
    setBulkPrice("");
    setBulkStock("");
  }

  const combosCount = liveOptions.reduce((n, o) => n * o.values.length, liveOptions.length ? 1 : 0);
  const tooMany = combosCount > MAX_VARIANTS;
  const totalStock = rows.reduce((n, r) => n + (Number(r.stockQty) || 0), 0);

  async function save() {
    setError(null);
    if (options.some((o) => clean(o.name) && o.values.length === 0)) {
      setError("Add at least one value to each option, or remove the empty option.");
      return;
    }
    if (tooMany) {
      setError(`That makes ${combosCount} combinations — the limit is ${MAX_VARIANTS}.`);
      return;
    }
    const bad = rows.find((r) => !(Number(r.price) > 0));
    if (bad) {
      setError("Every variant needs a price.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options: liveOptions,
          variants: rows.map((r) => ({
            id: r.id,
            options: liveOptions.length ? r.options : {},
            price: Number(r.price),
            compareAtPrice: r.compareAtPrice.trim() ? Number(r.compareAtPrice) : null,
            sku: r.sku.trim() || null,
            barcode: r.barcode.trim() || null,
            stockQty: Math.max(0, Math.trunc(Number(r.stockQty) || 0)),
            imageUrl: r.imageUrl,
          })),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
      onSaved(liveOptions.length ? `Saved ${rows.length} variants for ${productTitle}.` : `${productTitle} is a single-price product again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Sizes & colours — ${productTitle}`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl border border-white/10 bg-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">Sizes &amp; colours</p>
            <p className="truncate text-sm text-slate-400">{productTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <section className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-200">Options</p>
                  <p className="text-xs text-slate-400">
                    Up to {MAX_OPTIONS} options (e.g. Size, Color). Type values and press Enter or comma.
                  </p>
                </div>
                {options.map((option, index) => (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={option.name}
                        onChange={(e) => renameOption(index, e.target.value.slice(0, 40))}
                        onBlur={() => regenerate(options)}
                        placeholder="Option name (e.g. Size)"
                        aria-label="Option name"
                        className="h-10 w-40 rounded-lg border border-border bg-card px-3 text-sm"
                      />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {option.values.map((value) => (
                          <span
                            key={value}
                            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs"
                          >
                            {value}
                            <button
                              type="button"
                              onClick={() => removeValue(index, value)}
                              className="text-slate-400 hover:text-white"
                              aria-label={`Remove ${value}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {option.values.length < MAX_VALUES ? (
                          <input
                            value={pending[index] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v.includes(",")) addValues(index, v);
                              else setPending(pending.map((p, i) => (i === index ? v : p)));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addValues(index, pending[index] ?? "");
                              }
                            }}
                            onBlur={() => (pending[index] ?? "").trim() && addValues(index, pending[index] ?? "")}
                            placeholder={option.values.length ? "Add value" : "S, M, L"}
                            aria-label={`Values for ${option.name || "option"}`}
                            className="h-8 w-28 rounded-lg border border-dashed border-white/15 bg-transparent px-2 text-xs"
                          />
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                        aria-label={`Remove option ${option.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {options.length < MAX_OPTIONS ? (
                  <button
                    type="button"
                    onClick={addOption}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/20 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.04]"
                  >
                    <Plus className="h-4 w-4" /> {options.length === 0 ? "Add sizes, colours or other options" : "Add another option"}
                  </button>
                ) : null}
                {tooMany ? (
                  <p className="text-sm text-amber-300">
                    {combosCount} combinations — the limit is {MAX_VARIANTS}. Remove some values.
                  </p>
                ) : null}
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      {liveOptions.length ? `Variants (${rows.length})` : "Price & stock"}
                    </p>
                    <p className="text-xs text-slate-400">Total stock: {totalStock}</p>
                  </div>
                  {rows.length > 1 ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        value={bulkPrice}
                        onChange={(e) => setBulkPrice(e.target.value)}
                        type="number"
                        min="1"
                        placeholder="Price for all"
                        className="h-9 w-32 rounded-lg border border-border bg-card px-2 text-sm"
                      />
                      <input
                        value={bulkStock}
                        onChange={(e) => setBulkStock(e.target.value)}
                        type="number"
                        min="0"
                        placeholder="Stock for all"
                        className="h-9 w-32 rounded-lg border border-border bg-card px-2 text-sm"
                      />
                      <Button type="button" variant="secondary" size="sm" onClick={applyBulk} disabled={!bulkPrice && !bulkStock}>
                        Apply
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Variant</th>
                        <th className="px-3 py-2 font-medium">Price ₱</th>
                        <th className="px-3 py-2 font-medium">Compare-at</th>
                        <th className="px-3 py-2 font-medium">Stock</th>
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Barcode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={row.id ?? comboKey(liveOptions, row.options)} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2 font-medium text-slate-200">
                            {liveOptions.length ? liveOptions.map((o) => row.options[o.name]).join(" / ") : "Default"}
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.price}
                              onChange={(e) => setRow(index, { price: e.target.value })}
                              type="number"
                              min="1"
                              step="0.01"
                              aria-label="Price"
                              className="h-9 w-24 rounded-lg border border-border bg-card px-2"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.compareAtPrice}
                              onChange={(e) => setRow(index, { compareAtPrice: e.target.value })}
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label="Compare-at price"
                              className="h-9 w-24 rounded-lg border border-border bg-card px-2"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.stockQty}
                              onChange={(e) => setRow(index, { stockQty: e.target.value })}
                              type="number"
                              min="0"
                              aria-label="Stock"
                              className="h-9 w-20 rounded-lg border border-border bg-card px-2"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.sku}
                              onChange={(e) => setRow(index, { sku: e.target.value })}
                              aria-label="SKU"
                              className="h-9 w-28 rounded-lg border border-border bg-card px-2"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.barcode}
                              onChange={(e) => setRow(index, { barcode: e.target.value })}
                              aria-label="Barcode"
                              inputMode="numeric"
                              className="h-9 w-32 rounded-lg border border-border bg-card px-2"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">
                  Stock changes here are saved to the stock history. The shop shows the lowest price as “from ₱…”.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 p-4">
          {error ? <p className="mr-auto text-sm text-red-300">{error}</p> : null}
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || loading || tooMany || rows.length === 0}>
            {saving ? "Saving…" : "Save variants"}
          </Button>
        </div>
      </div>
    </div>
  );
}
