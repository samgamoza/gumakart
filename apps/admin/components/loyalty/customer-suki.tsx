"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Gift, Loader2 } from "lucide-react";
import { formatPrice } from "@gumakart/ui";
import { TierBadge } from "./tier-badge";

interface Loyalty {
  enabled: boolean;
  points: number;
  tier: string;
  spend12m: number;
  next: { tier: string; needed: number } | null;
  creditValue: number;
  canRedeem: boolean;
  rules: { minRedeem: number; pointValue: number };
}

/** Phase 27: a buyer's Suki tier and points, with "convert to store credit", inside Customers. */
export function CustomerSuki({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Loyalty | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const r = await fetch(`/api/loyalty/customers/${customerId}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setData(r.loyalty);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function redeem() {
    if (!data || !window.confirm(`Convert ${data.points} points to ${formatPrice(data.creditValue)} store credit?`)) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/loyalty/customers/${customerId}/redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No connection." }));
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't convert the points.");
    setResult({ code: r.code, amount: r.amount });
    void load();
  }

  if (!data || !data.enabled) return null;
  return (
    <div className="rounded-lg border border-violet-400/20 bg-violet-500/5 px-3 py-2.5" data-testid="customer-suki">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TierBadge tier={data.tier} />
          <span className="text-sm font-semibold">{Math.max(0, data.points)} pts</span>
          <span className="text-xs text-muted-foreground">≈ {formatPrice(data.creditValue)} credit</span>
        </div>
        {data.canRedeem && (
          <button type="button" onClick={() => void redeem()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />} Convert to store credit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatPrice(data.spend12m)} spent in 12 months
        {data.next ? ` · ${formatPrice(data.next.needed)} more for ${data.next.tier[0]!.toUpperCase()}${data.next.tier.slice(1)}` : " · top tier"}
        {!data.canRedeem && data.points > 0 ? ` · converts from ${data.rules.minRedeem} pts` : ""}
      </p>
      {result && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-xs">
          <span>
            Store credit <span className="font-mono font-semibold">{result.code}</span> · {formatPrice(result.amount)} — send this code to the buyer.
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(result.code).catch(() => null);
              setCopied(true);
            }}
            className="inline-flex flex-none items-center gap-1 text-violet-300"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
