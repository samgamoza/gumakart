"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Calculator, KeyRound, Loader2, UserPlus } from "lucide-react";
import { SettingsShell } from "@/components/settings/settings-shell";
import { SettingsCard, useTenantSettings } from "@/components/settings/settings-forms";
import { BirSettingsCard, XReadingButton } from "@/components/settings/bir-settings";
import { OfflineSalesCard } from "@/components/settings/pos-offline-settings";

interface Staff {
  id: string;
  name: string;
  role: "cashier" | "manager";
  active: boolean;
  lastLoginAt: string | null;
}

interface Shift {
  id: string;
  status: "open" | "closed";
  openingCash: number;
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  counted: Record<string, number> | null;
  variance: Record<string, number> | null;
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PinField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      className="guma-field h-10"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  );
}

export function PosSettingsPage() {
  const { settings, save, saving } = useTenantSettings();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", role: "cashier" as "cashier" | "manager", pin: "" });
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/pos-staff", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setStaff(r.staff);
      setShifts(r.shifts);
    } else setError(r?.error ?? "Could not load.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const r = await fetch(`/api/pos-staff/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json())
      .catch(() => ({ ok: false }));
    if (!r.ok) setError(r.error ?? "Could not save.");
    await load();
    return Boolean(r.ok);
  }

  const vat = settings?.settings?.pos ?? {};
  const vatRegistered = vat.vatRegistered === true;
  const vatInclusive = vat.vatInclusive !== false;

  return (
    <SettingsShell title="POS & staff" description="Who can use the register, how VAT shows on receipts, and past shifts.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/30 bg-violet-500/10 p-4 text-sm">
          <Calculator className="h-5 w-5 text-violet-300" />
          <p className="min-w-0 flex-1">
            Open <b>POS</b> on the phone or tablet at your counter and tap <b>Use this device for cashiers</b>. Staff then unlock it with their PIN — they
            can only sell and close shifts, not see your dashboard.
          </p>
          <Link href="/pos" className="rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white">
            Open POS
          </Link>
        </div>

        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

        <SettingsCard title="Staff">
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff yet. You can sell yourself while signed in; add cashiers to let others use the register.</p>
          ) : (
            <ul className="divide-y divide-border">
              {staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${s.active ? "" : "text-muted-foreground line-through"}`}>{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.role === "manager" ? "Manager" : "Cashier"}
                      {s.lastLoginAt ? ` · last in ${new Date(s.lastLoginAt).toLocaleDateString("en-PH")}` : " · never used"}
                    </p>
                  </div>
                  {resetFor === s.id ? (
                    <div className="flex items-center gap-2">
                      <div className="w-28">
                        <PinField value={resetPin} onChange={setResetPin} placeholder="New PIN" />
                      </div>
                      <button
                        type="button"
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                        disabled={resetPin.length < 4}
                        onClick={async () => {
                          if (await patch(s.id, { pin: resetPin })) {
                            setResetFor(null);
                            setResetPin("");
                          }
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="text-sm text-muted-foreground" onClick={() => setResetFor(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <select
                        className="guma-field h-9 w-auto"
                        value={s.role}
                        onChange={(e) => void patch(s.id, { role: e.target.value })}
                        aria-label={`Role for ${s.name}`}
                      >
                        <option value="cashier">Cashier</option>
                        <option value="manager">Manager</option>
                      </select>
                      <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5" onClick={() => { setResetFor(s.id); setResetPin(""); }}>
                        <KeyRound className="h-3.5 w-3.5" /> Reset PIN
                      </button>
                      <button type="button" className="rounded-lg border border-border px-3 py-1.5" onClick={() => void patch(s.id, { active: !s.active })}>
                        {s.active ? "Turn off" : "Turn on"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 grid gap-2 rounded-xl border border-dashed border-border p-3 sm:grid-cols-[1fr_130px_120px_auto]">
            <input className="guma-field h-10" placeholder="Name (e.g. Jen)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="guma-field h-10" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "cashier" | "manager" })}>
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
            </select>
            <PinField value={form.pin} onChange={(pin) => setForm({ ...form, pin })} placeholder="PIN (4–6)" />
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              disabled={busy || !form.name.trim() || form.pin.length < 4}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await fetch("/api/pos-staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
                  .then((x) => x.json())
                  .catch(() => ({ ok: false }));
                setBusy(false);
                if (!r.ok) return setError(r.error ?? "Could not add.");
                setForm({ name: "", role: "cashier", pin: "" });
                await load();
              }}
              data-testid="add-staff"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Give each person their own PIN. 5 wrong tries locks that person for 15 minutes. Resetting a PIN or turning someone off signs them out of the
            register right away.
          </p>
        </SettingsCard>

        <SettingsCard title="VAT on receipts">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={vatRegistered}
              disabled={saving}
              onChange={(e) => void save({ settings: { pos: { vatRegistered: e.target.checked } } })}
            />
            <span>
              <span className="font-medium">My business is VAT-registered</span>
              <span className="block text-muted-foreground">
                Off (most small shops): no VAT lines; Senior/PWD get 20% off the price. On: receipts show VAT 12%, and Senior/PWD sales remove VAT
                first, then 20% off (₱112 → ₱80).
              </span>
            </span>
          </label>
          {vatRegistered && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={vatInclusive}
                disabled={saving}
                onChange={(e) => void save({ settings: { pos: { vatInclusive: e.target.checked } } })}
              />
              <span>
                <span className="font-medium">My prices already include VAT</span>
                <span className="block text-muted-foreground">Usual for retail. Turn off only if VAT is added on top at the counter.</span>
              </span>
            </label>
          )}
          <p className="text-xs text-muted-foreground">Receipts say &ldquo;This is not an official receipt.&rdquo; until you turn on BIR sales invoices below.</p>
        </SettingsCard>

        <OfflineSalesCard />

        <BirSettingsCard />

        <SettingsCard title="Recent shifts">
          {shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {shifts.map((s) => {
                const variance = s.variance ? Object.values(s.variance).reduce((a, b) => a + b, 0) : null;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1">
                      {new Date(s.openedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {s.closedAt ? ` – ${new Date(s.closedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : ""}
                      <span className="block text-xs text-muted-foreground">
                        Opened by {s.openedBy ?? "—"}
                        {s.closedBy ? ` · closed by ${s.closedBy}` : ""}
                      </span>
                    </span>
                    <XReadingButton shiftId={s.id} />
                    {s.status === "open" ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">Open now</span>
                    ) : variance === 0 ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">Balanced</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${variance !== null && variance < 0 ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"}`}>
                        {variance !== null && variance < 0 ? `Short ${peso(-variance)}` : `Over ${peso(variance ?? 0)}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsCard>
      </div>
    </SettingsShell>
  );
}
