"use client";

import { useState } from "react";
import { Handshake } from "lucide-react";

/** Phase 18: shown while an agency partner works inside a client's shop. */
export function PartnerAccessBanner({ partnerName, shopName }: { partnerName: string; shopName?: string | null }) {
  const [pending, setPending] = useState(false);
  async function exit() {
    setPending(true);
    const res = await fetch("/api/partner/exit", { method: "POST" }).then((r) => r.json()).catch(() => null);
    window.location.href = res?.redirectTo ?? "/partner";
  }
  return (
    <div className="relative z-40 border-b border-sky-400/40 bg-sky-500 text-sky-950" data-testid="partner-banner">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Handshake className="h-4 w-4 shrink-0" />
          Partner mode — {partnerName} working in {shopName ?? "this shop"}. The owner sees what you do in the activity log.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void exit()}
          className="rounded-lg bg-sky-950 px-3 py-1.5 text-xs font-semibold text-sky-50 disabled:opacity-60"
        >
          {pending ? "Leaving…" : "Back to my shops"}
        </button>
      </div>
    </div>
  );
}
