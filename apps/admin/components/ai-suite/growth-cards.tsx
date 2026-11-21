"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Gift, Loader2, Megaphone, Package, X } from "lucide-react";
import { Card } from "@gumakart/ui";

/**
 * AI suite dashboard cards:
 *  - Phase 4: payday prompt on the 14th / 29th (Pro Live / Enterprise Vibe) → payday broadcast;
 *  - Phase 5: "Your branded packaging" mockups → Order on Printair (signed handoff, nothing to re-upload).
 */

interface PaydayState {
  entitled: boolean;
  payday: { show: boolean; period: string | null };
  segments: { tags: { VIP_REPEAT: number; PAYDAY_SHOPPER: number } };
}

export function PaydayBroadcastBanner() {
  const [s, setS] = useState<PaydayState | null>(null);
  useEffect(() => {
    fetch("/api/broadcasts")
      .then((r) => r.json())
      .then((j) => (j.ok ? setS(j) : null))
      .catch(() => null);
  }, []);
  if (!s?.entitled || !s.payday.show) return null;
  return (
    <div data-testid="payday-banner" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:border-amber-400/30 dark:from-amber-500/10 dark:to-orange-500/10">
      <Megaphone className="h-6 w-6 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-white">Payday bukas! 💸 Send a payday broadcast</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {s.segments.tags.PAYDAY_SHOPPER} payday shoppers and {s.segments.tags.VIP_REPEAT} VIP suki — each gets their own name and a one-tap reorder link.
        </p>
      </div>
      <Link href="/campaigns/broadcasts?new=payday" className="inline-flex min-h-[44px] items-center rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700">
        Create payday broadcast
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded-lg p-2 text-slate-500 hover:bg-black/5"
        onClick={async () => {
          await fetch("/api/broadcasts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss_payday" }) });
          setS({ ...s, payday: { ...s.payday, show: false } });
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface CardData {
  id: string;
  milestone: string;
  outputs: Array<{ url: string; kind: string; contentType: string; variant?: string }>;
}

const MILESTONE_COPY: Record<string, string> = {
  first_campaign: "Your first Marketing Studio campaign is live — make every parcel look like your brand too.",
  orders_10: "10 orders done! 🎉 Time to make every parcel look like your brand.",
  orders_50: "50 orders! Your buyers will love branded packaging.",
  orders_100: "100 orders! A branded unboxing keeps suki coming back.",
  orders_500: "500 orders! Level up your packaging for your loyal buyers.",
};

export function PrintairUpsellCard() {
  const [card, setCard] = useState<CardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/printair")
      .then((r) => r.json())
      .then((j) => setCard(j.ok ? j.card : null))
      .catch(() => null);
  }, []);
  useEffect(load, [load]);
  if (!card) return null;
  const images = card.outputs.filter((o) => o.kind === "image" && /mockup/.test(o.variant ?? o.url)).slice(0, 3);
  const shown = images.length ? images : card.outputs.filter((o) => o.kind === "image").slice(0, 3);
  const post = (action: "dismiss" | "handoff") =>
    fetch("/api/printair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id: card.id }) }).then((r) => r.json());
  return (
    <Card className="relative overflow-hidden">
      <span hidden data-testid="printair-card" />
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-black/5"
        onClick={async () => {
          await post("dismiss");
          setCard(null);
        }}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-violet-500" />
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Your branded packaging is ready to preview</h3>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{MILESTONE_COPY[card.milestone] ?? MILESTONE_COPY.orders_10}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {shown.map((o) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={o.url} src={o.url} alt={o.variant ?? "Packaging mockup"} className="aspect-square w-full rounded-xl border border-slate-200 object-cover dark:border-white/10" />
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <Gift className="h-3.5 w-3.5" /> Thank-you card · parcel sticker · mailer box — with your logo and shop QR code.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          data-testid="order-on-printair"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            setError(null);
            const j = await post("handoff").catch(() => ({ ok: false, error: "Couldn't reach Printair." }));
            setBusy(false);
            if (j.ok && j.url) window.location.href = j.url;
            else setError(j.error ?? "Couldn't open Printair.");
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Order on Printair
        </button>
        <span className="text-xs text-slate-500">Nothing to re-upload — your designs open in Printair checkout.</span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
