const STYLES: Record<string, string> = {
  bronze: "bg-amber-900/30 text-amber-300 border-amber-700/40",
  silver: "bg-slate-300/15 text-slate-200 border-slate-400/30",
  gold: "bg-yellow-400/15 text-yellow-300 border-yellow-500/40",
  platinum: "bg-violet-400/15 text-violet-200 border-violet-400/40",
};
const LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };

/** Phase 27: Suki tier chip. */
export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STYLES[tier] ?? STYLES.bronze}`}>
      ★ Suki {LABEL[tier] ?? tier}
    </span>
  );
}
