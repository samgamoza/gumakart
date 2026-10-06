"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Sparkles, X } from "lucide-react";

type Platform = "facebook" | "instagram" | "tiktok";
interface Captions {
  facebook: string;
  instagram: string;
  tiktok: string;
  hashtags: string[];
}

const TABS: Array<{ id: Platform; label: string }> = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
];

/**
 * Phase 26: AI captions for a product or checkout link (one AI generation per set). The seller
 * edits and copies; nothing is posted automatically.
 */
export function CaptionsButton({ productId, linkId, title, className = "" }: { productId?: string; linkId?: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.06]"}
        data-testid="captions-open"
        title="Write captions with AI"
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-300" /> Captions
      </button>
      {open && <CaptionsDialog productId={productId} linkId={linkId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function CaptionsDialog({ productId, linkId, title, onClose }: { productId?: string; linkId?: string; title: string; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const [captions, setCaptions] = useState<Captions | null>(null);
  const [tab, setTab] = useState<Platform>("facebook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/captions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(productId ? { productId, notes: notes || undefined } : { linkId, notes: notes || undefined }),
      });
      const d = await res.json();
      if (!d.ok) return setError(d.error ?? "Couldn't write captions.");
      setCaptions(d.captions);
    } catch {
      setError("No connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const text = captions ? `${captions[tab]}${captions.hashtags.length ? `\n\n${captions.hashtags.join(" ")}` : ""}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-label="Write captions" data-testid="captions-dialog">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1224] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-white">
              <Sparkles className="h-4 w-4 text-violet-300" /> Captions for “{title}”
            </p>
            <p className="mt-0.5 text-xs text-slate-400">Taglish captions with your link. Edit before you post.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!captions ? (
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-slate-400">
              Anything to mention? (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={600}
                rows={3}
                placeholder="e.g. Payday sale ngayong weekend, limited stocks"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-violet-400"
              />
            </label>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Writing…" : "Write captions (uses 1 AI generation)"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex gap-1 rounded-xl bg-black/30 p-1" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setCopied(false);
                  }}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={captions[tab]}
              onChange={(e) => setCaptions({ ...captions, [tab]: e.target.value })}
              rows={7}
              className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-violet-400"
              aria-label={`${tab} caption`}
            />
            {captions.hashtags.length > 0 && <p className="text-xs text-violet-200">{captions.hashtags.join(" ")}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(text).catch(() => null);
                  setCopied(true);
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy caption"}
              </button>
              <button type="button" onClick={() => setCaptions(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06]">
                Try again
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      </div>
    </div>
  );
}
