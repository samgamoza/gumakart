"use client";

import { useState } from "react";
import { Gift, X } from "lucide-react";

export interface AppliedGiftCard {
  code: string;
  balance: number;
  kind: "gift_card" | "store_credit";
}

/** Phase 17: "May gift card o store credit?" — checks the code, the server spends it at order time. */
export function GiftCardInput({
  tenantSlug,
  value,
  onChange,
  tone = "orange",
}: {
  tenantSlug: string;
  value: AppliedGiftCard | null;
  onChange: (card: AppliedGiftCard | null) => void;
  tone?: "orange" | "neutral";
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field =
    tone === "orange"
      ? "border-slate-200 bg-white focus:border-[var(--shop-accent,#7c3aed)] focus:ring-[color-mix(in_srgb,var(--shop-accent,#7c3aed)_22%,transparent)]"
      : "border-stone-300 bg-white focus:border-stone-500 focus:ring-stone-400/30";

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gift-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantSlug, code }) });
      const d = (await res.json()) as { ok: boolean; code?: string; balance?: number; kind?: AppliedGiftCard["kind"]; error?: string };
      if (!d.ok || !d.code) return setError(d.error ?? "Hindi magamit ang card.");
      onChange({ code: d.code, balance: Number(d.balance), kind: d.kind ?? "gift_card" });
      setCode("");
    } catch {
      setError("Walang internet — subukan ulit.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm" data-testid="giftcard-applied">
        <span className="flex items-center gap-2 text-emerald-800">
          <Gift className="h-4 w-4" />
          <span>
            <span className="font-mono font-semibold">{value.code}</span> · balance ₱
            {value.balance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}
          </span>
        </span>
        <button type="button" aria-label="Remove gift card" className="rounded p-1 text-emerald-700 hover:bg-emerald-100" onClick={() => onChange(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          placeholder="Gift card / store credit (GC-XXXX-XXXX)"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className={`h-11 min-w-0 flex-1 rounded-md border px-3 font-mono text-sm tracking-wide text-stone-900 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus:ring-2 ${field}`}
          data-testid="giftcard-input"
        />
        <button
          type="button"
          disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}
          onClick={() => void apply()}
          className="h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
          data-testid="giftcard-apply"
        >
          {busy ? "…" : "Gamitin"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
