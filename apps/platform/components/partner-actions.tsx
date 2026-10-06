"use client";

import { useState, useTransition } from "react";
import { setPartnerStatusAction } from "@/app/actions";

/** Phase 18: approve / suspend a partner. Suspending blocks their shop access at once. */
export function PartnerActions({ partnerId, name, status }: { partnerId: string; name: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  function run(next: "active" | "suspended") {
    setErr(null);
    const note = next === "suspended" ? window.prompt(`Why suspend ${name}? (shown to the partner)`) : null;
    if (next === "suspended" && note === null) return;
    start(async () => {
      const res = await setPartnerStatusAction(partnerId, next, name, note);
      if (!res.ok) setErr(res.error ?? "Failed.");
    });
  }
  return (
    <div className="flex items-center justify-end gap-2">
      {err && <span className="text-xs text-rose-600">{err}</span>}
      {status !== "active" && (
        <button type="button" disabled={pending} onClick={() => run("active")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {status === "pending" ? "Approve" : "Reactivate"}
        </button>
      )}
      {status !== "suspended" && (
        <button type="button" disabled={pending} onClick={() => run("suspended")} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">
          Suspend
        </button>
      )}
    </div>
  );
}
