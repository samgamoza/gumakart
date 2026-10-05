"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Phase 16 — owners see a thin banner when the paid plan ends within 3 days or is in grace. */
export function PlanNoticeBanner() {
  const [text, setText] = useState<{ msg: string; urgent: boolean } | null>(null);
  useEffect(() => {
    void fetch("/api/billing/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean; status?: { state: string; daysLeft: number | null; graceEndsAt: string | null } } | null) => {
        const s = d?.ok ? d.status : null;
        if (!s) return;
        if (s.state === "grace") {
          const when = s.graceEndsAt ? new Date(s.graceEndsAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }) : "soon";
          setText({ msg: `Your plan has ended. Paid features stay on until ${when} — renew to keep them.`, urgent: true });
        } else if (s.state === "expiring" && (s.daysLeft ?? 9) <= 3) {
          setText({ msg: `Your plan ends in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}.`, urgent: false });
        }
      })
      .catch(() => undefined);
  }, []);
  if (!text) return null;
  return (
    <div className={`relative z-[60] px-4 py-2 text-center text-sm ${text.urgent ? "bg-red-600 text-white" : "bg-amber-400 text-slate-900"}`} data-testid="plan-banner">
      {text.msg}{" "}
      <Link href="/settings/subscription" className="font-semibold underline">
        Renew
      </Link>
    </div>
  );
}
