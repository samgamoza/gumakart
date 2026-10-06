"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Gift, Loader2, Plus, Search } from "lucide-react";
import { Button, Card } from "@gumakart/ui";

/**
 * Phase 17 — Gift cards & store credit. Issue a card (sold at the counter, a prize, a
 * goodwill credit), see balances and history, disable or correct one. Store credit is also
 * created from a return ("Refund as store credit"). Buyers use the code at checkout or POS.
 */

interface CardRow {
  id: string;
  code: string;
  kind: "gift_card" | "store_credit";
  initialAmount: number;
  balance: number;
  status: "active" | "disabled";
  customerPhone: string | null;
  recipientName: string | null;
  note: string | null;
  expiresAt: string | null;
  createdByName: string;
  createdAt: string;
}

interface Txn {
  id: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "—");
const KIND_LABEL: Record<string, string> = { issue: "Issued", redeem: "Used", restore: "Put back", adjust: "Adjusted" };

function History({ card, onChanged }: { card: CardRow; onChanged: () => void }) {
  const [rows, setRows] = useState<Txn[] | null>(null);
  const [adjust, setAdjust] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const d = (await (await fetch(`/api/gift-cards/${card.id}`, { cache: "no-store" })).json()) as { ok: boolean; history: Txn[] };
    if (d.ok) setRows(d.history);
  }, [card.id]);
  useEffect(() => void load(), [load]);
  async function patch(body: Record<string, unknown>) {
    setMsg(null);
    const d = (await (await fetch(`/api/gift-cards/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as { ok: boolean; error?: string };
    if (!d.ok) return setMsg(d.error ?? "Could not save.");
    setAdjust("");
    setNote("");
    await load();
    onChanged();
  }
  return (
    <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
      {!rows ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <ul className="space-y-1 text-xs" data-testid="gift-history">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {day(r.createdAt)} · {KIND_LABEL[r.kind] ?? r.kind}
                {r.note ? ` — ${r.note}` : ""}
                {r.actorName ? ` (${r.actorName})` : ""}
              </span>
              <span className={r.amount < 0 ? "text-amber-200" : "text-emerald-300"}>
                {r.amount > 0 ? "+" : ""}
                {peso(r.amount)} → {peso(r.balanceAfter)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input className="guma-field h-9 w-28" type="number" step="0.01" value={adjust} onChange={(e) => setAdjust(e.target.value)} placeholder="+/- ₱" aria-label="Adjust by" />
        <input className="guma-field h-9 min-w-0 flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (kept in history)" maxLength={200} />
        <Button type="button" size="sm" variant="secondary" disabled={!Number(adjust) || !note.trim()} onClick={() => void patch({ adjust: Number(adjust), note })}>
          Adjust
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void patch({ status: card.status === "active" ? "disabled" : "active" })}>
          {card.status === "active" ? "Disable card" : "Enable card"}
        </Button>
      </div>
      {msg && <p className="text-xs text-red-300">{msg}</p>}
    </div>
  );
}

export function GiftCardsView() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [summary, setSummary] = useState<{ outstanding: number; active: number; redeemed30d: number } | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: "500", kind: "gift_card" as "gift_card" | "store_credit", recipientName: "", phone: "", note: "", expires: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [issued, setIssued] = useState<CardRow | null>(null);

  const load = useCallback(async (query = "") => {
    const d = (await (await fetch(`/api/gift-cards${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" })).json()) as { ok: boolean; cards: CardRow[]; summary: typeof summary; error?: string };
    if (d.ok) {
      setCards(d.cards);
      setSummary(d.summary);
    } else setMsg({ text: d.error ?? "Could not load.", ok: false });
  }, []);
  useEffect(() => void load(), [load]);

  async function issue() {
    setBusy(true);
    setMsg(null);
    const expiresAt = form.expires ? new Date(`${form.expires}T23:59:59+08:00`).toISOString() : null;
    const d = (await (
      await fetch("/api/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(form.amount), kind: form.kind, recipientName: form.recipientName || undefined, phone: form.phone || undefined, note: form.note || undefined, expiresAt }),
      })
    ).json()) as { ok: boolean; card?: CardRow; error?: string };
    setBusy(false);
    if (!d.ok || !d.card) return setMsg({ text: d.error ?? "Could not issue.", ok: false });
    setIssued(d.card);
    setForm({ ...form, recipientName: "", phone: "", note: "" });
    await load(q);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <p className="text-sm text-muted-foreground">
        Buyers type the code at checkout (online or checkout links) or give it at the POS. Cancelled or refunded orders put the amount back on the card.
      </p>
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Unused balance</p>
            <p className="text-xl font-bold">{peso(summary.outstanding)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Cards with balance</p>
            <p className="text-xl font-bold">{summary.active}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Used in 30 days</p>
            <p className="text-xl font-bold">{peso(summary.redeemed30d)}</p>
          </Card>
        </div>
      )}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gift className="h-4 w-4" /> Issue a card
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Amount (₱)
            <input className="guma-field mt-1 h-10 w-full" type="number" min="1" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="gift-amount" />
          </label>
          <label className="text-sm">
            Type
            <select className="guma-field mt-1 h-10 w-full" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
              <option value="gift_card">Gift card</option>
              <option value="store_credit">Store credit</option>
            </select>
          </label>
          <label className="text-sm">
            Expires (optional)
            <input className="guma-field mt-1 h-10 w-full" type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          </label>
          <label className="text-sm">
            For (name)
            <input className="guma-field mt-1 h-10 w-full" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} maxLength={120} placeholder="optional" data-testid="gift-name" />
          </label>
          <label className="text-sm">
            Mobile
            <input className="guma-field mt-1 h-10 w-full" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09XX… (links to the customer)" inputMode="tel" />
          </label>
          <label className="text-sm">
            Note
            <input className="guma-field mt-1 h-10 w-full" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} placeholder="e.g. Paid cash at the stall" />
          </label>
        </div>
        <Button type="button" className="mt-4" onClick={() => void issue()} disabled={busy || !(Number(form.amount) >= 1)} data-testid="gift-issue">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Issue card
        </Button>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
        {issued && (
          <div className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4" data-testid="gift-issued">
            <p className="text-sm text-emerald-200">
              {issued.kind === "store_credit" ? "Store credit" : "Gift card"} for {peso(issued.initialAmount)} — give the buyer this code:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded-lg bg-black/30 px-3 py-2 font-mono text-lg tracking-wider">{issued.code}</code>
              <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs" onClick={() => void navigator.clipboard?.writeText(issued.code)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cards</h2>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              void load(q);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input className="guma-field h-9 w-64 pl-8 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, name or mobile" />
          </form>
        </div>
        {!cards ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No cards yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/10" data-testid="gift-list">
            {cards.map((c) => {
              const expired = Boolean(c.expiresAt && Date.parse(c.expiresAt) < Date.now());
              return (
                <li key={c.id} className="py-3">
                  <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <code className="font-mono text-sm">{c.code}</code>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{c.kind === "store_credit" ? "Store credit" : "Gift card"}</span>
                    {(c.status === "disabled" || expired) && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-200">{c.status === "disabled" ? "Disabled" : "Expired"}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {[c.recipientName, c.customerPhone, c.note].filter(Boolean).join(" · ")}
                    </span>
                    <span className="text-right text-sm">
                      <b>{peso(c.balance)}</b> <span className="text-xs text-muted-foreground">of {peso(c.initialAmount)}</span>
                    </span>
                  </button>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Issued {day(c.createdAt)} by {c.createdByName}
                    {c.expiresAt ? ` · expires ${day(c.expiresAt)}` : ""}
                  </p>
                  {open === c.id && <History card={c} onChanged={() => void load(q)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
