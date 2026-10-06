"use client";

import { useState } from "react";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/** Phase 32: the buyer's referral link — copy or share; friend and buyer both get store credit. */
export function SukiShare({ slug, shopName, referral }: { slug: string; shopName: string; referral: { code: string; referrerReward: number; friendReward: number; minOrder: number } }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? `/${slug}?ref=suki&code=${referral.code}` : `${window.location.origin}/${slug}?ref=suki&code=${referral.code}`;
  const text = `Order ka sa ${shopName} gamit ang link ko — may ${peso(referral.friendReward)} store credit ka pagkatapos ng unang order mo! ${link}`;
  return (
    <div className="mt-3 rounded-xl border border-violet-200 bg-white/70 p-3" data-testid="suki-share">
      <p className="text-xs font-semibold text-violet-800">
        Mag-invite ng kaibigan: {peso(referral.friendReward)} para sa kanila, {peso(referral.referrerReward)} para sa iyo
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Store credit pagkatapos mabayaran ang una nilang order ({peso(referral.minOrder)} pataas). Code mo: <span className="font-mono font-bold">{referral.code}</span>
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => null);
            setCopied(true);
          }}
          className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"
        >
          {copied ? "Na-copy!" : "Copy link"}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" onClick={() => void navigator.share({ text }).catch(() => undefined)} className="flex-1 rounded-lg border border-violet-300 px-3 py-2 text-xs font-bold text-violet-700">
            I-share
          </button>
        )}
      </div>
    </div>
  );
}
