"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { resolveReviewReportAction } from "@/app/actions";

/** Phase 23: ops decision on a seller's report — keep the review, or remove it for good. */
export function ReviewReportActions({ reviewId, label }: { reviewId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(decision: "kept" | "removed") {
    setError(null);
    startTransition(async () => {
      const res = await resolveReviewReportAction(reviewId, decision, label);
      if (!res.ok) setError(res.error ?? "Failed");
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <button
        type="button"
        disabled={pending}
        onClick={() => run("kept")}
        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
      >
        Keep review
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run("removed")}
        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
      >
        Remove for good
      </button>
    </div>
  );
}
