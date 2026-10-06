"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Card } from "@gumakart/ui";
import { code128Svg } from "@/lib/code128";
import { useShopRole } from "@/lib/use-shop-role";

type Row = {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  productStatus: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  stockQty: number;
};

type Format = "thermal" | "a4";

const FORMATS: Record<Format, { label: string; hint: string }> = {
  thermal: { label: "Thermal 40 × 30 mm", hint: "One label per page — set your label printer to 40×30 mm." },
  a4: { label: "A4 sheet (3 × 8)", hint: "24 labels of 70 × 37 mm per page (common sticker sheets)." },
};

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Phase 24: barcode + price labels. Uses the variant barcode (or SKU); items without either can get an
 * in-store barcode in one tap. The POS register adds an item when its label is scanned.
 */
export function LabelPrinter() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [shop, setShop] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<Format>("thermal");
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { can } = useShopRole();

  const load = useCallback(async () => {
    const [inv, s] = await Promise.all([
      fetch("/api/inventory", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/shop", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (inv.ok) setRows((inv.rows as Row[]).filter((r) => r.productStatus !== "archived"));
    if (s?.ok) setShop(s.shop.tenant.name);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setNotice(null);
    const d = await fetch("/api/inventory/barcodes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .catch(() => ({ ok: false }));
    setBusy(false);
    setNotice(d.ok ? `${d.assigned} item${d.assigned === 1 ? "" : "s"} got a barcode.` : d.error ?? "Could not generate barcodes.");
    await load();
  }

  const codeOf = (r: Row) => (r.barcode?.trim() || r.sku?.trim() || "").slice(0, 40);
  const visible = useMemo(
    () => (rows ?? []).filter((r) => `${r.productTitle} ${r.variantTitle ?? ""} ${r.sku ?? ""}`.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );
  const missing = (rows ?? []).filter((r) => !codeOf(r)).length;

  const labels = useMemo(() => {
    const out: Array<{ key: string; row: Row; code: string }> = [];
    for (const r of rows ?? []) {
      const n = Math.min(500, Math.max(0, Math.floor(Number(qty[r.variantId] ?? 0)) || 0));
      const code = codeOf(r);
      if (!code) continue;
      for (let i = 0; i < n; i++) out.push({ key: `${r.variantId}-${i}`, row: r, code });
    }
    return out;
  }, [rows, qty]);

  const setAll = (fn: (r: Row) => number) =>
    setQty(Object.fromEntries((rows ?? []).filter((r) => codeOf(r)).map((r) => [r.variantId, String(fn(r))])));

  const pageCss =
    format === "thermal"
      ? `@page { size: 40mm 30mm; margin: 0; } .lbl { width: 40mm; height: 30mm; break-after: page; }`
      : `@page { size: A4; margin: 10mm 0 0 0; } .sheet { display: grid; grid-template-columns: repeat(3, 70mm); } .lbl { width: 70mm; height: 37mm; } .lbl:nth-child(24n) { break-after: page; }`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <style>{`
        .lbl svg { width: 100%; height: 100%; display: block; }
        @media print {
          body * { visibility: hidden !important; }
          .label-sheet, .label-sheet * { visibility: visible !important; }
          .label-sheet { position: absolute; left: 0; top: 0; background: #fff; }
          ${pageCss}
        }
      `}</style>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select className="guma-field h-9 text-sm" value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Label size">
            {(Object.keys(FORMATS) as Format[]).map((f) => (
              <option key={f} value={f}>
                {FORMATS[f].label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Show price
          </label>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => setAll(() => 1)}>
            1 of each
          </button>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => setAll((r) => Math.max(0, r.stockQty))}>
            One per item in stock
          </button>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => setQty({})}>
            Clear
          </button>
          <button
            type="button"
            disabled={labels.length === 0}
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            data-testid="print-labels"
          >
            <Printer className="h-4 w-4" /> Print {labels.length} label{labels.length === 1 ? "" : "s"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{FORMATS[format].hint} Scanning a label at the POS adds that item.</p>
        {missing > 0 && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {missing} item{missing === 1 ? " has" : "s have"} no barcode or SKU yet.
            {can("products.edit") ? (
              <button type="button" disabled={busy} onClick={() => void generate()} className="font-semibold underline" data-testid="generate-barcodes">
                {busy ? "Generating…" : "Give them in-store barcodes"}
              </button>
            ) : null}
          </p>
        )}
        {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/[0.06] p-3">
          <input className="guma-field h-9 w-full text-sm" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!rows ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading items…
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {visible.map((r) => {
                const code = codeOf(r);
                return (
                  <tr key={r.variantId} className="border-t border-white/[0.06]" data-testid="label-row">
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.productTitle}</span>
                      {r.variantTitle ? <span className="text-muted-foreground"> · {r.variantTitle}</span> : null}
                      <span className="block font-mono text-[11px] text-muted-foreground">{code || "no barcode"}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{peso(Number(r.price))}</td>
                    <td className="w-28 px-4 py-1.5">
                      <input
                        type="number"
                        min="0"
                        max="500"
                        disabled={!code}
                        value={qty[r.variantId] ?? ""}
                        placeholder="0"
                        onChange={(e) => setQty((q) => ({ ...q, [r.variantId]: e.target.value }))}
                        aria-label={`How many labels for ${r.productTitle}`}
                        className="h-9 w-20 rounded-lg border border-border bg-card px-2"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {labels.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Preview</p>
          <div className="label-sheet sheet flex flex-wrap gap-2 bg-white p-2 text-black" data-testid="label-sheet">
            {labels.map((l) => (
              <Label key={l.key} shop={shop} row={l.row} code={l.code} showPrice={showPrice} format={format} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ shop, row, code, showPrice, format }: { shop: string; row: Row; code: string; showPrice: boolean; format: Format }) {
  const svg = useMemo(() => {
    try {
      return code128Svg(code, 40).svg;
    } catch {
      return null;
    }
  }, [code]);
  const big = format === "a4";
  return (
    <div
      className="lbl flex flex-col justify-between overflow-hidden border border-dashed border-gray-300 bg-white px-[2mm] py-[1.5mm] text-black print:border-0"
      style={{ width: big ? "70mm" : "40mm", height: big ? "37mm" : "30mm", fontFamily: "Arial, sans-serif" }}
      data-testid="label"
    >
      <div className="flex items-start justify-between gap-1">
        <p className="truncate text-[6.5pt] uppercase tracking-wide">{shop}</p>
        {showPrice ? <p className={`${big ? "text-[11pt]" : "text-[9pt]"} font-bold leading-none`}>{peso(Number(row.price))}</p> : null}
      </div>
      <p className={`line-clamp-2 ${big ? "text-[8pt]" : "text-[7pt]"} font-semibold leading-tight`}>
        {row.productTitle}
        {row.variantTitle ? ` · ${row.variantTitle}` : ""}
      </p>
      {svg ? <div className="h-[9mm] w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="text-[6pt] text-red-600">Code can&apos;t be printed</p>}
      <p className="text-center font-mono text-[6.5pt] leading-none tracking-wider">{code}</p>
    </div>
  );
}
