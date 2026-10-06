"use client";

import { useCallback, useEffect, useState } from "react";
import { SettingsPageLayout } from "@/components/settings/settings-shell";
import { SettingsCard } from "@/components/settings/settings-forms";

type Receiving = {
  gcashNumber: string;
  gcashName: string;
  mayaNumber: string;
  mayaName: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
};

type PaymentsMode = "manual_ewallet" | "paymongo" | "both";

const MODE_LABELS: Record<PaymentsMode, string> = {
  manual_ewallet: "Direct e-wallet (GCash / Maya / bank)",
  both: "Direct e-wallet + PayMongo",
  paymongo: "PayMongo only",
};

export function PaymentsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [effectiveMode, setEffectiveMode] = useState<PaymentsMode>("manual_ewallet");
  const [expiryHours, setExpiryHours] = useState("24");
  const [modeSetByPlatform, setModeSetByPlatform] = useState(false);
  const [receiving, setReceiving] = useState<Receiving>({
    gcashNumber: "",
    gcashName: "",
    mayaNumber: "",
    mayaName: "",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings");
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setError(data.error ?? "Could not load settings.");
      return;
    }
    const payments = data.settings?.settings?.payments ?? {};
    setExpiryHours(String(data.settings?.settings?.checkout?.unpaidExpiryHours ?? 24));
    setEffectiveMode(
      (data.effectivePaymentsMode as PaymentsMode) ?? payments.mode ?? "manual_ewallet"
    );
    setModeSetByPlatform(Boolean(data.paymentsModeSetByPlatform));
    setReceiving({
      gcashNumber: payments.receiving?.gcashNumber ?? "",
      gcashName: payments.receiving?.gcashName ?? "",
      mayaNumber: payments.receiving?.mayaNumber ?? "",
      mayaName: payments.receiving?.mayaName ?? "",
      bankName: payments.receiving?.bankName ?? "",
      bankAccountName: payments.receiving?.bankAccountName ?? "",
      bankAccountNumber: payments.receiving?.bankAccountNumber ?? "",
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const hours = Math.min(72, Math.max(1, Math.round(Number(expiryHours) || 24)));
    setExpiryHours(String(hours));
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          payments: { receiving },
          checkout: { unpaidExpiryHours: hours },
        },
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) {
      setError(data.error ?? "Save failed.");
      return;
    }
    setMessage("Payment settings saved.");
  }

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const paymongoLive = effectiveMode === "paymongo" || effectiveMode === "both";

  return (
    <SettingsPageLayout
      title="Payments"
      description="Set the GCash / Maya / bank details buyers see for direct transfer. PayMongo activation is controlled by Guma Platform."
    >
      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <SettingsCard title="Checkout payments mode">
        <div
          className={`rounded-xl border px-3 py-3 text-sm ${
            paymongoLive
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-border bg-muted/40 text-foreground"
          }`}
        >
          <p className="font-semibold">{MODE_LABELS[effectiveMode]}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {paymongoLive
              ? "PayMongo is enabled for your shop by Platform ops."
              : "Buyers pay your numbers directly; you confirm in Orders."}{" "}
            {modeSetByPlatform
              ? "This shop has a Platform override."
              : "Using the platform-wide default."}{" "}
            To change mode (including activating PayMongo), contact Guma support / Platform ops —
            sellers cannot self-activate.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="GCash receiving">
        <p className="mb-2 text-sm text-muted-foreground">
          Shown to buyers at checkout / order tracking for direct e-wallet.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Account name
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.gcashName}
              onChange={(e) => setReceiving((r) => ({ ...r, gcashName: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Mobile number
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.gcashNumber}
              onChange={(e) => setReceiving((r) => ({ ...r, gcashNumber: e.target.value }))}
              placeholder="09XXXXXXXXX"
            />
          </label>
        </div>
      </SettingsCard>

      <SettingsCard title="Maya receiving">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Account name
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.mayaName}
              onChange={(e) => setReceiving((r) => ({ ...r, mayaName: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Mobile number
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.mayaNumber}
              onChange={(e) => setReceiving((r) => ({ ...r, mayaNumber: e.target.value }))}
              placeholder="09XXXXXXXXX"
            />
          </label>
        </div>
      </SettingsCard>

      <SettingsCard title="Bank (optional)">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Bank name
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.bankName}
              placeholder="e.g. GoTyme, BPI, BDO, UnionBank"
              onChange={(e) => setReceiving((r) => ({ ...r, bankName: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Account name
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.bankAccountName}
              onChange={(e) => setReceiving((r) => ({ ...r, bankAccountName: e.target.value }))}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Account number
            <input
              className="mt-1 h-10 w-full rounded-lg border px-3"
              value={receiving.bankAccountNumber}
              onChange={(e) =>
                setReceiving((r) => ({ ...r, bankAccountNumber: e.target.value }))
              }
            />
          </label>
        </div>
      </SettingsCard>

      <SettingsCard title="Unpaid orders">
        <label className="block text-sm">
          Cancel unpaid orders after
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={72}
              className="h-10 w-24 rounded-lg border px-3"
              value={expiryHours}
              onChange={(e) => setExpiryHours(e.target.value)}
            />
            <span className="text-muted-foreground">hours (1–72)</span>
          </span>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          The items go back into stock. Orders where the buyer already sent a payment reference
          stay open until you confirm or reject the payment.
        </p>
      </SettingsCard>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save payment settings"}
      </button>
    </SettingsPageLayout>
  );
}
