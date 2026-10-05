"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, X } from "lucide-react";
import { Button } from "@gumakart/ui";
import { SettingsCard } from "@/components/settings/settings-forms";
import { useShopRole } from "@/lib/use-shop-role";

/**
 * Phase 11 — BIR-ready POS. Off until the owner fills in the PTU details and switches it on.
 * Also: X reading for any shift, Z reading per register, e-journal export.
 */

interface Bir {
  enabled?: boolean;
  registeredName?: string;
  tradeName?: string;
  tin?: string;
  branchCode?: string;
  address?: string;
  min?: string;
  serialNo?: string;
  ptuNo?: string;
  ptuDate?: string;
  accreditationNo?: string;
  invoicePrefix?: string;
}

interface Totals {
  transactions: number;
  grossSales: number;
  regularDiscounts: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  returns: number;
  returnCount: number;
  voids: number;
  voidCount: number;
  netSales: number;
  cash: number;
  gcash: number;
  maya: number;
  card: number;
  firstInvoice: string | null;
  lastInvoice: string | null;
}

interface ZRow {
  id: string;
  zNumber: number;
  fromAt: string | null;
  toAt: string;
  fromInvoice: string | null;
  toInvoice: string | null;
  totals: Totals;
  grandTotalBefore: number;
  grandTotalAfter: number;
  createdByName: string;
}

interface Status {
  bir: Bir;
  vatRegistered: boolean;
  missing: string[];
  active: boolean;
  registers: Array<{ registerId: string; registerName: string; pendingShifts: number; openShift: boolean; lastZAt: string | null; nextZ: number }>;
  readings: ZRow[];
}

const FIELDS: Array<{ key: keyof Bir; label: string; placeholder?: string; required?: boolean }> = [
  { key: "registeredName", label: "Registered name (as on COR)", required: true },
  { key: "tradeName", label: "Trade / business name" },
  { key: "tin", label: "TIN", placeholder: "000-000-000", required: true },
  { key: "branchCode", label: "Branch code", placeholder: "000" },
  { key: "address", label: "Registered address", required: true },
  { key: "min", label: "MIN (machine ID on PTU)", required: true },
  { key: "serialNo", label: "Serial number", required: true },
  { key: "ptuNo", label: "PTU number", required: true },
  { key: "ptuDate", label: "PTU date issued", placeholder: "YYYY-MM-DD" },
  { key: "accreditationNo", label: "Accreditation no. (if any)" },
  { key: "invoicePrefix", label: "Invoice prefix", placeholder: "e.g. SI" },
];

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ReadingTable({ t }: { t: Totals }) {
  const rows: Array<[string, string]> = [
    ["Transactions", String(t.transactions)],
    ["Invoices", t.firstInvoice ? `${t.firstInvoice} – ${t.lastInvoice}` : "—"],
    ["Gross sales", peso(t.grossSales)],
    ["Regular discounts", peso(t.regularDiscounts)],
    ["Senior discounts", peso(t.seniorDiscounts)],
    ["PWD discounts", peso(t.pwdDiscounts)],
    ["VATable sales", peso(t.vatableSales)],
    ["VAT", peso(t.vatAmount)],
    ["VAT-exempt sales", peso(t.vatExemptSales)],
    ["Zero-rated sales", peso(t.zeroRatedSales)],
    [`Returns (${t.returnCount})`, peso(t.returns)],
    [`Voids (${t.voidCount})`, peso(t.voids)],
    ["Net sales", peso(t.netSales)],
    ["Cash", peso(t.cash)],
    ["GCash", peso(t.gcash)],
    ["Maya", peso(t.maya)],
    ["Card", peso(t.card)],
  ];
  return (
    <table className="w-full font-mono text-xs">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-border/60">
            <td className="py-1 pr-3 text-muted-foreground">{k}</td>
            <td className={`py-1 text-right ${k === "Net sales" ? "font-bold" : ""}`}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BirSettingsCard() {
  const perms = useShopRole();
  const isOwner = perms.role === "owner";
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<Bir>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const [zShown, setZShown] = useState<ZRow | null>(null);
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const load = useCallback(async () => {
    const res = await fetch("/api/bir/status", { cache: "no-store" });
    const d = (await res.json()) as Status & { ok: boolean; error?: string };
    if (!d.ok) return setError(d.error ?? "Could not load.");
    setStatus(d);
    setForm(d.bir ?? {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function saveBir(patch: Bir, done: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { pos: { bir: patch } } }),
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!d.ok) return setError(d.error ?? "Could not save.");
    setNotice(done);
    await load();
  }

  async function runZ(registerId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bir/z", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ registerId }) });
    const d = (await res.json()) as { ok: boolean; error?: string; reading?: ZRow };
    setBusy(false);
    if (!d.ok || !d.reading) return setError(d.error ?? "Could not run the Z reading.");
    setZShown(d.reading);
    await load();
  }

  if (!status) {
    return (
      <SettingsCard title="BIR sales invoices (POS)">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      </SettingsCard>
    );
  }

  const { enabled: _enabled, ...details } = form;
  void _enabled;

  return (
    <SettingsCard title="BIR sales invoices (POS)">
      {notice && <p className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-200">{error}</p>}

      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ${status.active ? "bg-emerald-500/10" : "bg-muted/60"}`}>
        <div>
          <p className="text-sm font-semibold">{status.active ? "On — receipts are numbered sales invoices" : "Off — receipts say “not an official receipt”"}</p>
          <p className="text-xs text-muted-foreground">
            Turn on only after your BIR Permit to Use (PTU) for this POS and your accountant&apos;s go-signal. Guma Kart isn&apos;t a BIR-accredited POS provider yet.
          </p>
        </div>
        {isOwner &&
          (status.active ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void saveBir({ enabled: false }, "BIR numbering turned off. Numbers already used stay used.")}>
              Turn off
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy || status.missing.length > 0} onClick={() => setConfirmOn(true)}>
              Turn on
            </Button>
          ))}
      </div>
      {!status.active && status.missing.length > 0 && <p className="text-xs text-muted-foreground">Needed before turning on: {status.missing.join(", ")}.</p>}

      {confirmOn && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Before you turn this on</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>The details below match your PTU and Certificate of Registration.</li>
            <li>Every POS sale from now on gets the next invoice number per register — numbers are never reused or reset.</li>
            <li>Run a Z reading at the end of each business day (below) and keep the e-journal.</li>
          </ul>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void saveBir({ ...details, enabled: true }, "BIR numbering is on.").then(() => setConfirmOn(false))}>
              Yes, turn on
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmOn(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <input
              className="guma-field h-10"
              value={String(form[f.key] ?? "")}
              placeholder={f.placeholder}
              disabled={!isOwner}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {isOwner && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveBir(details, "BIR details saved.")}>
            Save details
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-semibold">Z reading (end of day)</p>
        {status.registers.map((r) => (
          <div key={r.registerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {r.registerName} · next Z #{r.nextZ}
              <span className="block text-xs text-muted-foreground">
                {r.openShift ? "Shift open — close it first" : `${r.pendingShifts} closed shift${r.pendingShifts === 1 ? "" : "s"} since the last Z`}
              </span>
            </span>
            <Button type="button" size="sm" variant="secondary" disabled={busy || r.openShift} onClick={() => void runZ(r.registerId)} data-testid="run-z">
              Run Z reading
            </Button>
          </div>
        ))}
        {status.readings.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {status.readings.slice(0, 10).map((z) => (
              <li key={z.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  Z #{z.zNumber} · {new Date(z.toAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  <span className="block text-xs text-muted-foreground">Net {peso(z.totals.netSales)} · grand total {peso(z.grandTotalAfter)}</span>
                </span>
                <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setZShown(z)}>
                  <FileText className="h-3.5 w-3.5" /> View
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
        <label className="text-xs text-muted-foreground">
          From
          <input type="date" className="guma-field mt-1 h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <input type="date" className="guma-field mt-1 h-9" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <a className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm hover:bg-muted" href={`/api/bir/ejournal?from=${from}&to=${to}`}>
          <Download className="h-4 w-4" /> E-journal CSV
        </a>
      </div>

      {zShown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setZShown(null)} role="dialog" aria-modal="true" aria-label="Z reading">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-black" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-sm font-bold">Z READING #{zShown.zNumber}</p>
              <button type="button" onClick={() => setZShown(null)} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="font-mono text-[11px] text-gray-600">
              {zShown.fromAt ? new Date(zShown.fromAt).toLocaleString("en-PH") : "First reading"} → {new Date(zShown.toAt).toLocaleString("en-PH")}
            </p>
            <div className="mt-3"><ReadingTable t={zShown.totals} /></div>
            <table className="mt-2 w-full font-mono text-xs">
              <tbody>
                <tr><td className="py-1 text-gray-600">Grand total before</td><td className="py-1 text-right">{peso(zShown.grandTotalBefore)}</td></tr>
                <tr><td className="py-1 font-bold">Grand total after</td><td className="py-1 text-right font-bold">{peso(zShown.grandTotalAfter)}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 font-mono text-[10px] text-gray-500">By {zShown.createdByName}</p>
            <button type="button" className="mt-3 w-full rounded-lg bg-black py-2 text-sm font-semibold text-white" onClick={() => window.print()}>Print</button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

/** X reading for one shift (no reset). */
export function XReadingButton({ shiftId }: { shiftId: string }) {
  const [data, setData] = useState<{ registerName: string; openedAt: string; closedAt: string | null; totals: Totals } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/bir/x?shiftId=${shiftId}`, { cache: "no-store" });
    const d = (await res.json()) as { ok: boolean; error?: string; reading?: typeof data };
    setBusy(false);
    if (!d.ok || !d.reading) return setErr(d.error ?? "Could not load.");
    setData(d.reading);
  }
  return (
    <>
      <button type="button" className="text-xs text-primary hover:underline disabled:opacity-50" onClick={() => void open()} disabled={busy}>
        {busy ? "…" : "X reading"}
      </button>
      {err && <span className="text-xs text-red-500">{err}</span>}
      {data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setData(null)} role="dialog" aria-modal="true" aria-label="X reading">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-black" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-mono text-sm font-bold">X READING · {data.registerName}</p>
              <button type="button" onClick={() => setData(null)} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="font-mono text-[11px] text-gray-600">
              {new Date(data.openedAt).toLocaleString("en-PH")} → {data.closedAt ? new Date(data.closedAt).toLocaleString("en-PH") : "still open"}
            </p>
            <div className="mt-3"><ReadingTable t={data.totals} /></div>
            <button type="button" className="mt-3 w-full rounded-lg bg-black py-2 text-sm font-semibold text-white" onClick={() => window.print()}>Print</button>
          </div>
        </div>
      )}
    </>
  );
}
