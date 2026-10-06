"use client";

import { useEffect, useState } from "react";
import { Button, formatPrice } from "@gumakart/ui";
import { SettingsPageLayout } from "@/components/settings/settings-shell";
import { SettingsCard, SettingsField, inputClassName } from "@/components/settings/settings-forms";
import { TierBadge } from "./tier-badge";

interface Rules {
  enabled: boolean;
  pesoPerPoint: number;
  pointValue: number;
  minRedeem: number;
  tiers: { silver: number; gold: number; platinum: number };
}
interface Summary {
  rules: Rules;
  members: Record<"bronze" | "silver" | "gold" | "platinum", number>;
  pointsOutstanding: number;
  creditOutstanding: number;
  redeemed30d: number;
}

const MULT = { bronze: 1, silver: 1.25, gold: 1.5, platinum: 2 } as const;

/** Phase 27: Settings → Suki loyalty. */
export function LoyaltySettingsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/loyalty", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setSummary(r);
      setForm(r.rules);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(next: Rules) {
    setSaving(true);
    setMsg(null);
    const r = await fetch("/api/loyalty", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No connection." }));
    setSaving(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "Couldn't save." });
    setMsg({ ok: true, text: next.enabled ? "Saved. Paid orders from now on earn Suki points." : "Saved." });
    void load();
  }

  const set = (patch: Partial<Rules>) => form && setForm({ ...form, ...patch });
  const example = form ? Math.floor(1000 / form.pesoPerPoint) : 0;

  return (
    <SettingsPageLayout title="Suki loyalty" description="Reward repeat buyers with points they turn into store credit. Tiers go up as they spend more with you.">
      {!form || !summary ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4" data-testid="loyalty-settings">
          <SettingsCard title="Suki points">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" data-testid="loyalty-enabled" />
              <span>
                <span className="font-medium">Turn on Suki points</span>
                <span className="block text-xs text-muted-foreground">Only orders paid after you turn it on earn points. Buyers see their points on their order page.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <SettingsField label="Spend per 1 point (₱)" hint="₱20–₱1,000">
                <input type="number" min={20} max={1000} className={inputClassName()} value={form.pesoPerPoint} onChange={(e) => set({ pesoPerPoint: Number(e.target.value) })} />
              </SettingsField>
              <SettingsField label="1 point is worth (₱)" hint="₱0.10–₱5 store credit">
                <input type="number" step="0.1" min={0.1} max={5} className={inputClassName()} value={form.pointValue} onChange={(e) => set({ pointValue: Number(e.target.value) })} />
              </SettingsField>
              <SettingsField label="Convert from (points)">
                <input type="number" min={1} className={inputClassName()} value={form.minRedeem} onChange={(e) => set({ minRedeem: Number(e.target.value) })} />
              </SettingsField>
            </div>
            <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Example: a {formatPrice(1000)} order earns <strong>{example} pts</strong> (Bronze) up to <strong>{example * 2} pts</strong> (Platinum) —{" "}
              {formatPrice(example * form.pointValue)}–{formatPrice(example * 2 * form.pointValue)} back as store credit (
              {((form.pointValue / form.pesoPerPoint) * 100).toFixed(1)}%–{((form.pointValue / form.pesoPerPoint) * 200).toFixed(1)}%). Delivery fees and gift-card payments don&apos;t earn.
            </p>
          </SettingsCard>

          <SettingsCard title="Tiers (spend with you in the last 12 months)">
            <div className="grid gap-4 sm:grid-cols-3">
              {(["silver", "gold", "platinum"] as const).map((t) => (
                <SettingsField key={t} label={`${t[0]!.toUpperCase()}${t.slice(1)} from (₱)`} hint={`Earns ${MULT[t]}× points`}>
                  <input type="number" min={100} className={inputClassName()} value={form.tiers[t]} onChange={(e) => set({ tiers: { ...form.tiers, [t]: Number(e.target.value) } })} />
                </SettingsField>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Bronze is everyone else (1× points).</p>
          </SettingsCard>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void save(form)} disabled={saving} data-testid="loyalty-save">
              {saving ? "Saving…" : "Save"}
            </Button>
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</p>}
          </div>

          <SettingsCard title="Your Suki">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["bronze", "silver", "gold", "platinum"] as const).map((t) => (
                <div key={t} className="rounded-xl border border-border bg-card p-3">
                  <TierBadge tier={t} />
                  <p className="mt-2 text-2xl font-bold">{summary.members[t]}</p>
                  <p className="text-xs text-muted-foreground">buyers</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Unused points: <strong>{summary.pointsOutstanding}</strong> (≈ {formatPrice(summary.creditOutstanding)} store credit) · Converted in the last 30 days:{" "}
              <strong>{summary.redeemed30d}</strong> pts. Convert a buyer&apos;s points from <strong>Customers</strong>.
            </p>
          </SettingsCard>
        </div>
      )}
    </SettingsPageLayout>
  );
}
