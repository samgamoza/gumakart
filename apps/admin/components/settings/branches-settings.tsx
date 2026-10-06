"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, Plus } from "lucide-react";
import { Button, Card } from "@gumakart/ui";
import { SettingsPageLayout } from "@/components/settings/settings-shell";

/**
 * Phase 17 — Branches. One branch = one place stock sits and a register can sell from.
 * Adding the second branch turns on stock per branch (everything starts at the main branch).
 */

interface Branch {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
  units: number;
}

export function BranchesSettingsPage() {
  const [data, setData] = useState<{ enabled: boolean; branches: Branch[] } | null>(null);
  const [form, setForm] = useState({ name: "", addressLine: "", city: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const d = (await (await fetch("/api/branches", { cache: "no-store" })).json()) as { ok: boolean; enabled: boolean; branches: Branch[]; error?: string };
    if (d.ok) setData({ enabled: d.enabled, branches: d.branches });
    else setMsg({ text: d.error ?? "Could not load.", ok: false });
  }, []);
  useEffect(() => void load(), [load]);

  async function add() {
    setBusy(true);
    setMsg(null);
    const d = (await (await fetch("/api/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })).json()) as { ok: boolean; error?: string };
    setBusy(false);
    if (!d.ok) return setMsg({ text: d.error ?? "Could not add.", ok: false });
    setForm({ name: "", addressLine: "", city: "", phone: "" });
    setMsg({ text: "Branch added. Move stock to it from Stock → By branch, and pick it on the POS.", ok: true });
    await load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setMsg(null);
    const d = (await (await fetch(`/api/branches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as { ok: boolean; error?: string };
    if (!d.ok) setMsg({ text: d.error ?? "Could not save.", ok: false });
    await load();
  }

  return (
    <SettingsPageLayout title="Branches" description="Your store, stall, bodega or warehouse. Each branch keeps its own stock; POS registers sell from one branch.">
      <div className="mx-auto max-w-3xl space-y-4 pb-24">
        {data && !data.enabled && (
          <p className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            You have one branch. Add another and stock is tracked per branch from then on — everything you have now starts at the main branch.
          </p>
        )}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin className="h-4 w-4" /> Branches
          </h2>
          {!data ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-white/10" data-testid="branch-list">
              {data.branches.map((b) => (
                <li key={b.id} className={`flex flex-wrap items-center gap-3 py-3 ${b.isActive ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {b.name}
                      {b.isDefault && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">Main</span>}
                      {!b.isActive && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Off</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{[b.addressLine, b.city, b.phone].filter(Boolean).join(" · ") || "No address yet"}</p>
                  </div>
                  {data.enabled && <span className="text-sm">{b.units} in stock</span>}
                  <div className="flex gap-1">
                    {!b.isDefault && b.isActive && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void patch(b.id, { makeDefault: true })}>
                        Make main
                      </Button>
                    )}
                    {!b.isDefault && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => void patch(b.id, { isActive: !b.isActive })}>
                        {b.isActive ? "Turn off" : "Turn on"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data?.enabled && (
            <Link href="/inventory/branches" className="mt-2 inline-block text-sm text-violet-300 underline">
              Stock by branch, transfers and counts →
            </Link>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Add a branch</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className="guma-field h-10" placeholder="Name (e.g. SM Lipa stall)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} data-testid="branch-name" />
            <input className="guma-field h-10" placeholder="Mobile (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} />
            <input className="guma-field h-10" placeholder="Address (optional)" value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} maxLength={300} />
            <input className="guma-field h-10" placeholder="City (optional)" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={120} />
          </div>
          <Button type="button" className="mt-3" onClick={() => void add()} disabled={busy || form.name.trim().length < 2} data-testid="branch-add">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add branch
          </Button>
          {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
        </Card>
      </div>
    </SettingsPageLayout>
  );
}
