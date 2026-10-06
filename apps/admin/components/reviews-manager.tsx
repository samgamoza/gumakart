"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { Card } from "@gumakart/ui";
import type { ReviewFilter, ReviewStats, SellerReviewRow } from "@gumakart/db";
import { useShopRole } from "@/lib/use-shop-role";

const FILTERS: Array<{ id: ReviewFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "low", label: "3★ and below" },
  { id: "hidden", label: "Hidden" },
  { id: "reported", label: "Reported" },
];

/**
 * Phase 23: verified reviews from delivered orders. Sellers reply in public, hide with a private
 * reason, or report to Guma. Nobody edits what the buyer wrote.
 */
export function ReviewsManager({ storefrontUrl }: { storefrontUrl: string }) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [rows, setRows] = useState<SellerReviewRow[] | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = useShopRole();
  const canManage = can("marketing.manage");

  const load = useCallback(async () => {
    const res = await fetch(`/api/reviews?filter=${filter}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) {
      setRows(d.reviews);
      setStats(d.stats);
      setError(null);
    } else setError(d.error ?? "Could not load reviews.");
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const photoSrc = (p: string) => (p.startsWith("/") ? `${storefrontUrl}${p}` : p);

  return (
    <div className="mx-auto max-w-4xl space-y-4" data-testid="reviews-manager">
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Shop rating" value={stats.average != null ? `${stats.average.toFixed(1)} ★` : "—"} sub={`${stats.count} published`} />
          <Kpi label="Last 30 days" value={String(stats.last30)} sub="new reviews" />
          <Kpi label="Needs reply" value={String(stats.needsReply)} />
          <Kpi label="With Guma" value={String(stats.openReports)} sub="reports open" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.id ? "bg-violet-600 text-white" : "bg-white/5 text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!rows ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reviews…
        </p>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {filter === "all"
            ? "No reviews yet. Buyers can rate their items from the order page once it's delivered, and get a text asking 2 days later (if they said yes to texts)."
            : "Nothing here."}
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <ReviewRow key={r.id} review={r} canManage={canManage} photoSrc={photoSrc} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function ReviewRow({
  review: r,
  canManage,
  photoSrc,
  onChanged,
}: {
  review: SellerReviewRow;
  canManage: boolean;
  photoSrc: (p: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"reply" | "hide" | "report" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!d.ok) setError(d.error ?? "Could not save.");
      else {
        setMode(null);
        setText("");
        await onChanged();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="review-row">
      <Card className={`p-4 ${r.status !== "published" ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1" aria-label={`${r.rating} stars`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
              ))}
              <span className="ml-2 text-sm font-medium">{r.buyerName}</span>
              <span className="ml-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">Verified buyer</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.productTitle ?? "Product removed"} · Order {r.orderNumber} · {new Date(r.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {r.status === "hidden" && <span className="rounded-full bg-white/10 px-2 py-0.5">Hidden: {r.hiddenReason}</span>}
            {r.status === "removed" && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-400">Removed by Guma</span>}
            {r.reportStatus === "open" && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">Reported — Guma is checking</span>}
            {r.reportStatus === "kept" && <span className="rounded-full bg-white/10 px-2 py-0.5">Guma kept it</span>}
          </div>
        </div>

        {r.body ? <p className="mt-3 whitespace-pre-line text-sm">{r.body}</p> : <p className="mt-3 text-sm italic text-muted-foreground">Stars only.</p>}
        {r.photos.length > 0 && (
          <div className="mt-3 flex gap-2">
            {r.photos.map((p) => (
              <a key={p} href={photoSrc(p)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoSrc(p)} alt="" className="h-20 w-20 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {r.sellerReply && (
          <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
            <span className="font-semibold">Your reply:</span> {r.sellerReply}
          </p>
        )}

        {canManage && r.status !== "removed" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => { setMode("reply"); setText(r.sellerReply ?? ""); }}>
              {r.sellerReply ? "Edit reply" : "Reply"}
            </button>
            {r.status === "published" ? (
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => { setMode("hide"); setText(""); }}>
                Hide
              </button>
            ) : (
              <button type="button" disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => void act({ action: "show" })}>
                Show again
              </button>
            )}
            {!r.reportStatus && (
              <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-red-400" onClick={() => { setMode("report"); setText(""); }}>
                Report to Guma
              </button>
            )}
          </div>
        )}

        {mode && (
          <div className="mt-3 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={mode === "reply" ? 3 : 2}
              maxLength={mode === "reply" ? 600 : 200}
              className="guma-field w-full text-sm"
              placeholder={
                mode === "reply"
                  ? "Public reply, e.g. Salamat po! Sorry sa delay, babawi kami next order."
                  : mode === "hide"
                    ? "Why hide it? Only you see this (e.g. courier problem, wrong shop)."
                    : "What's wrong? e.g. abusive words, spam, personal info, not a real buyer experience."
              }
            />
            {mode === "hide" && <p className="text-xs text-muted-foreground">Hidden reviews don't count in your shop rating. Buyers can still see their own review.</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                onClick={() => void act(mode === "reply" ? { action: "reply", reply: text } : { action: mode, reason: text })}
              >
                {busy ? "Saving…" : mode === "reply" ? "Post reply" : mode === "hide" ? "Hide review" : "Send report"}
              </button>
              <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground" onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </Card>
    </li>
  );
}
