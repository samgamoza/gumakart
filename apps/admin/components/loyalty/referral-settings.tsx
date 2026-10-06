"use client";

import { useEffect, useState } from "react";
import { Button, formatPrice } from "@gumakart/ui";
import { SettingsCard, SettingsField, inputClassName } from "@/components/settings/settings-forms";

interface Rules {
  enabled: boolean;
  referrerReward: number;
  friendReward: number;
  minOrder: number;
  monthlyCap: number;
}
interface Summary {
  rules: Rules;
  rewarded30d: number;
  blocked30d: number;
  creditIssued30d: number;
  topReferrers: Array<{ name: string | null; phone: string; count: number }>;
}

/** Phase 32: "Give ₱50, get ₱50" — referral rules and results, inside Settings → Suki loyalty. */
export function ReferralSettings({ loyaltyOn }: { loyaltyOn: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState<Rules | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/loyalty/referrals", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setSummary(r);
      setForm(r.rules);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch("/api/loyalty/referrals", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No connection." }));
    setSaving(false);
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Couldn't save." });
    if (r.ok) void load();
  }

  if (!form || !summary) return null;
  const set = (p: Partial<Rules>) => setForm({ ...form, ...p });
  return (
    <SettingsCard title="Referrals — give & get store credit">
      <div data-testid="referral-settings" className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" data-testid="referral-enabled" />
          <span>
            <span className="font-medium">Turn on referrals</span>
            <span className="block text-xs text-muted-foreground">
              Buyers get a share link on their order page. When a new buyer&apos;s first order is paid, both get store credit.
              {!loyaltyOn && " Turn on Suki points above too — the share link lives on the Suki card."}
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-4">
          <SettingsField label="Inviter gets (₱)">
            <input type="number" min={0} max={5000} className={inputClassName()} value={form.referrerReward} onChange={(e) => set({ referrerReward: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="New buyer gets (₱)">
            <input type="number" min={0} max={5000} className={inputClassName()} value={form.friendReward} onChange={(e) => set({ friendReward: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="First order at least (₱)">
            <input type="number" min={0} className={inputClassName()} value={form.minOrder} onChange={(e) => set({ minOrder: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="Rewards per inviter / month">
            <input type="number" min={1} max={100} className={inputClassName()} value={form.monthlyCap} onChange={(e) => set({ monthlyCap: Number(e.target.value) })} />
          </SettingsField>
        </div>
        <p className="text-xs text-muted-foreground">
          Not rewarded: the same phone number, a buyer who already ordered from you, a first order under the minimum, or an inviter who hasn&apos;t paid for an order yet.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={saving} data-testid="referral-save">
            {saving ? "Saving…" : "Save referrals"}
          </Button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</p>}
        </div>
        <p className="text-sm text-muted-foreground">
          Last 30 days: <strong>{summary.rewarded30d}</strong> rewarded ({formatPrice(summary.creditIssued30d)} store credit) · {summary.blocked30d} not eligible
          {summary.topReferrers.length > 0 && ` · Top inviters: ${summary.topReferrers.map((t) => `${t.name ?? t.phone} (${t.count})`).join(", ")}`}
        </p>
      </div>
    </SettingsCard>
  );
}
