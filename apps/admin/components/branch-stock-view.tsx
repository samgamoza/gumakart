"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2, Search } from "lucide-react";
import { Button, Card } from "@gumakart/ui";

/** Phase 17 — stock per branch: count one branch, or move stock between branches. */

interface Branch {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}
interface Row {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  total: number;
  byBranch: Record<string, number>;
}

export function BranchStockView() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"view" | "count" | "transfer">("view");
  const [countAt, setCountAt] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async (query = "") => {
    const d = (await (await fetch(`/api/inventory/branches${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" })).json()) as { ok: boolean; branches: Branch[]; rows: Row[]; error?: string };
    if (!d.ok) return setMsg({ text: d.error ?? "Could not load.", ok: false });
    const active = d.branches.filter((b) => b.isActive);
    setBranches(active);
    setRows(d.rows);
    setCountAt((v) => v || active[0]?.id || "");
    setFrom((v) => v || active[0]?.id || "");
    setTo((v) => v || active[1]?.id || "");
  }, []);
  useEffect(() => void load(), [load]);

  const name = useMemo(() => new Map((branches ?? []).map((b) => [b.id, b.name])), [branches]);

  async function saveCount() {
    const items = Object.entries(counts)
      .filter(([, v]) => v !== "")
      .map(([variantId, v]) => ({ variantId, qty: Math.max(0, Math.trunc(Number(v))) }));
    if (!items.length) return;
    setBusy(true);
    setMsg(null);
    const d = (await (await fetch("/api/inventory/branches", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: countAt, items }) })).json()) as { ok: boolean; changed?: number; error?: string };
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not save.", ok: false });
    setMsg({ text: `Saved — ${d.changed} item(s) changed at ${name.get(countAt)}.`, ok: true });
    setCounts({});
    setMode("view");
    await load(q);
  }

  async function saveTransfer() {
    const items = Object.entries(moves)
      .filter(([, v]) => Number(v) > 0)
      .map(([variantId, v]) => ({ variantId, qty: Math.trunc(Number(v)) }));
    setBusy(true);
    setMsg(null);
    const d = (await (await fetch("/api/inventory/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromId: from, toId: to, items, note: note || undefined }) })).json()) as { ok: boolean; moved?: number; error?: string };
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not move.", ok: false });
    setMsg({ text: `Moved ${d.moved} item(s) from ${name.get(from)} to ${name.get(to)}.`, ok: true });
    setMoves({});
    setNote("");
    setMode("view");
    await load(q);
  }

  if (!branches) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (branches.length < 2) {
    return (
      <Card className="p-5 text-sm">
        Stock by branch starts when you have two branches.{" "}
        <Link href="/settings/branches" className="text-violet-300 underline">
          Add a branch
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            void load(q);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input className="guma-field h-9 w-60 pl-8 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product or SKU" />
        </form>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant={mode === "count" ? "primary" : "secondary"} onClick={() => setMode(mode === "count" ? "view" : "count")} data-testid="mode-count">
            Count a branch
          </Button>
          <Button type="button" size="sm" variant={mode === "transfer" ? "primary" : "secondary"} onClick={() => setMode(mode === "transfer" ? "view" : "transfer")} data-testid="mode-transfer">
            <ArrowRightLeft className="h-4 w-4" /> Move stock
          </Button>
        </div>
      </div>

      {mode === "count" && (
        <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
          Counting at
          <select className="guma-field h-9" value={countAt} onChange={(e) => setCountAt(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Type what&apos;s on the shelf; blanks stay as they are. The shop total follows.</span>
          <Button type="button" size="sm" className="ml-auto" disabled={busy} onClick={() => void saveCount()} data-testid="count-save">
            Save count
          </Button>
        </Card>
      )}
      {mode === "transfer" && (
        <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
          From
          <select className="guma-field h-9" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          to
          <select className="guma-field h-9" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input className="guma-field h-9 min-w-0 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. Grab delivery 3 PM)" maxLength={150} />
          <Button type="button" size="sm" disabled={busy || from === to || !Object.values(moves).some((v) => Number(v) > 0)} onClick={() => void saveTransfer()} data-testid="transfer-save">
            Move
          </Button>
        </Card>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="branch-stock-table">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-white/10">
              <th className="px-4 py-2 font-medium">Item</th>
              {branches.map((b) => (
                <th key={b.id} className="px-3 py-2 text-right font-medium">
                  {b.name}
                  {b.isDefault ? " (main)" : ""}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium">Total</th>
              {mode === "transfer" && <th className="px-3 py-2 text-right font-medium">Move</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => (
              <tr key={r.variantId}>
                <td className="px-4 py-2">
                  {r.productTitle}
                  {r.variantTitle !== "Default" && r.variantTitle !== r.productTitle ? <span className="text-muted-foreground"> · {r.variantTitle}</span> : null}
                  {r.sku ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">{r.sku}</span> : null}
                </td>
                {branches.map((b) => (
                  <td key={b.id} className="px-3 py-2 text-right tabular-nums">
                    {mode === "count" && b.id === countAt ? (
                      <input
                        className="guma-field h-8 w-20 text-right"
                        type="number"
                        min="0"
                        placeholder={String(r.byBranch[b.id] ?? 0)}
                        value={counts[r.variantId] ?? ""}
                        onChange={(e) => setCounts({ ...counts, [r.variantId]: e.target.value })}
                        aria-label={`${r.productTitle} at ${b.name}`}
                      />
                    ) : (
                      <span className={(r.byBranch[b.id] ?? 0) === 0 ? "text-muted-foreground" : ""}>{r.byBranch[b.id] ?? 0}</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.total}</td>
                {mode === "transfer" && (
                  <td className="px-3 py-2 text-right">
                    <input
                      className="guma-field h-8 w-20 text-right"
                      type="number"
                      min="0"
                      max={r.byBranch[from] ?? 0}
                      value={moves[r.variantId] ?? ""}
                      onChange={(e) => setMoves({ ...moves, [r.variantId]: e.target.value })}
                      disabled={(r.byBranch[from] ?? 0) === 0}
                      aria-label={`Move ${r.productTitle}`}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
