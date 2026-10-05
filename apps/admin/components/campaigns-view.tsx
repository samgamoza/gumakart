"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Megaphone, Plus, Send, ShieldCheck, X } from "lucide-react";
import { Button, Card, formatPrice } from "@gumakart/ui";

/**
 * Phase 14 — SMS campaigns to customer groups. Consent only (buyers who ticked "text me" at
 * checkout), every text has a Stop link, never 9 PM–8 AM, one text per number per campaign.
 * Semaphore stays ready to hook up: without it the composer saves drafts and explains.
 */

type SegmentKind = "all" | "repeat" | "vip" | "lapsed" | "new" | "channel";

interface Segment {
  kind: SegmentKind;
  minSpend?: number;
  days?: number;
  channel?: string;
}

interface Campaign {
  id: string;
  name: string;
  segment: Segment;
  segmentLabel: string;
  body: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt: string | null;
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  createdAt: string;
  orders: number;
  sales: number;
}

const SEGMENTS: Array<{ kind: SegmentKind; label: string; hint: string }> = [
  { kind: "all", label: "Everyone who said yes", hint: "All buyers who ticked “text me” at checkout" },
  { kind: "repeat", label: "Repeat buyers", hint: "2 or more orders" },
  { kind: "vip", label: "VIPs", hint: "Spent at least an amount" },
  { kind: "lapsed", label: "Haven't ordered lately", hint: "Win them back" },
  { kind: "new", label: "New buyers", hint: "First order recently" },
  { kind: "channel", label: "By channel", hint: "Bought through TikTok, Facebook…" },
];

const STATUS: Record<Campaign["status"], string> = {
  draft: "bg-white/10 text-muted-foreground",
  scheduled: "bg-sky-500/15 text-sky-300",
  sending: "bg-violet-500/20 text-violet-200",
  sent: "bg-emerald-500/15 text-emerald-300",
  cancelled: "bg-white/5 text-muted-foreground line-through",
};

async function call<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "No connection." } as T & { ok: boolean; error?: string };
  }
}

export function CampaignsView() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [smsReady, setSmsReady] = useState(true);
  const [smsLive, setSmsLive] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await call<{ campaigns: Campaign[]; smsReady: boolean; smsLive: boolean }>("/api/campaigns");
    if (!d.ok) return setError(d.error ?? "Could not load.");
    setList(d.campaigns);
    setSmsReady(d.smsReady);
    setSmsLive(d.smsLive);
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <p className="min-w-0 flex-1 text-muted-foreground">
          Only buyers who ticked &ldquo;text me&rdquo; at checkout get campaigns. Every text has your shop name and a Stop link, and nothing goes out 9 PM–8 AM. Each text costs one SMS credit per
          160 characters.
        </p>
        <Button type="button" size="sm" onClick={() => setComposing(true)} data-testid="new-campaign">
          <Plus className="h-4 w-4" /> New campaign
        </Button>
      </div>
      {!smsReady && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> SMS sending isn&apos;t connected yet (malapit na). You can prepare campaigns as drafts and send them once it&apos;s on.
        </p>
      )}
      {smsReady && !smsLive && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200" data-testid="campaign-test-mode">
          Test mode: texts are recorded but not really sent (no SMS provider on this server).
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {composing && (
        <Composer
          smsReady={smsReady}
          onClose={() => setComposing(false)}
          onDone={async () => {
            setComposing(false);
            await load();
          }}
        />
      )}

      {!list ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : list.length === 0 ? (
        !composing && (
          <Card className="p-8 text-center">
            <Megaphone className="mx-auto h-6 w-6 text-violet-300" />
            <p className="mt-2 font-semibold">Tell your suki about a sale</p>
            <p className="text-sm text-muted-foreground">Pick a group — repeat buyers, VIPs, people who haven&apos;t ordered lately — and text them a link to your shop.</p>
          </Card>
        )
      ) : (
        <ul className="space-y-3" data-testid="campaign-list">
          {list.map((c) => (
            <CampaignCard key={c.id} c={c} smsReady={smsReady} reload={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({ c, smsReady, reload }: { c: Campaign; smsReady: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = c.sent + c.failed + c.suppressed;
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{c.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS[c.status]}`}>{c.status}</span>
          <span className="text-xs text-muted-foreground">{c.segmentLabel}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {c.status === "scheduled" && c.scheduledAt ? `Sends ${new Date(c.scheduledAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : new Date(c.createdAt).toLocaleDateString("en-PH")}
          </span>
        </div>
        <p className="mt-2 rounded-lg bg-white/[0.04] p-2 text-sm">{c.body}</p>
        {c.status !== "draft" && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Sent" value={`${c.sent}/${c.recipients}`} />
            <Stat label="Not sent" value={String(c.failed + c.suppressed)} sub={c.suppressed ? `${c.suppressed} pressed Stop` : undefined} />
            <Stat label="Orders from it" value={String(c.orders)} />
            <Stat label="Sales from it" value={formatPrice(c.sales)} />
          </div>
        )}
        {c.status === "sending" && c.recipients > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-white/5" aria-label={`${done} of ${c.recipients} done`}>
            <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${(done / c.recipients) * 100}%` }} />
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {c.status === "draft" && (
            <Button
              type="button"
              size="sm"
              disabled={busy || !smsReady}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                const r = await call(`/api/campaigns/${c.id}`, { method: "POST", body: JSON.stringify({ sendAt: null }) });
                setBusy(false);
                if (!r.ok) setErr(r.error ?? "Could not send.");
                await reload();
              }}
              data-testid="campaign-send"
            >
              <Send className="h-4 w-4" /> Send now
            </Button>
          )}
          {(c.status === "draft" || c.status === "scheduled" || c.status === "sending") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (c.status !== "draft" && !window.confirm("Stop this campaign? Texts already sent stay sent.")) return;
                setBusy(true);
                await call(`/api/campaigns/${c.id}`, { method: "DELETE" });
                setBusy(false);
                await reload();
              }}
            >
              {c.status === "draft" ? "Discard" : "Stop"}
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Composer({ smsReady, onClose, onDone }: { smsReady: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>({ kind: "all" });
  const [body, setBody] = useState("Hi {name}! Payday sale: 10% off everything until Sunday. Order here:");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [preview, setPreview] = useState<{ count: number; consented: number; preview: string | null; segments: number | null; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await call<{ count: number; consented: number; preview: string | null; segments: number | null; sample: string[] }>("/api/campaigns/preview", {
        method: "POST",
        body: JSON.stringify({ segment, body }),
      });
      if (r.ok) setPreview(r);
    }, 400);
    return () => window.clearTimeout(t);
  }, [segment, body]);

  async function submit(send: boolean) {
    setBusy(true);
    setErr(null);
    const created = await call<{ campaign: { id: string } }>("/api/campaigns", { method: "POST", body: JSON.stringify({ name: name || "Campaign", segment, body }) });
    if (!created.ok) {
      setBusy(false);
      return setErr(created.error ?? "Could not save.");
    }
    if (send) {
      const sendAt = when === "later" && at ? new Date(at).toISOString() : null;
      const q = await call(`/api/campaigns/${created.campaign.id}`, { method: "POST", body: JSON.stringify({ sendAt }) });
      if (!q.ok) {
        setBusy(false);
        setErr(`${q.error ?? "Could not send."} The draft was saved.`);
        await onDone();
        return;
      }
    }
    setBusy(false);
    await onDone();
  }

  const chars = body.length;
  return (
    <Card className="p-5" >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">New SMS campaign</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 space-y-4" data-testid="campaign-composer">
        <input className="guma-field h-10" placeholder="Name (only you see it), e.g. 10.10 sale" value={name} onChange={(e) => setName(e.target.value)} aria-label="Campaign name" />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Who gets it</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {SEGMENTS.map((s) => (
              <button
                key={s.kind}
                type="button"
                onClick={() => setSegment({ kind: s.kind, ...(s.kind === "vip" ? { minSpend: 3000 } : s.kind === "lapsed" ? { days: 60 } : s.kind === "new" ? { days: 30 } : s.kind === "channel" ? { channel: "tiktok" } : {}) })}
                className={`rounded-xl border p-2.5 text-left text-sm ${segment.kind === s.kind ? "border-violet-500 bg-violet-600/15" : "border-white/10 hover:border-white/20"}`}
                aria-pressed={segment.kind === s.kind}
              >
                <span className="block font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {segment.kind === "vip" && (
              <>
                Spent at least ₱
                <input type="number" min="1" className="guma-field h-9 w-28" value={segment.minSpend ?? 3000} onChange={(e) => setSegment({ ...segment, minSpend: Number(e.target.value) || 1 })} aria-label="Minimum spend" />
              </>
            )}
            {(segment.kind === "lapsed" || segment.kind === "new") && (
              <>
                {segment.kind === "lapsed" ? "No order in the last" : "First order in the last"}
                <input type="number" min="1" className="guma-field h-9 w-20" value={segment.days ?? 30} onChange={(e) => setSegment({ ...segment, days: Math.trunc(Number(e.target.value)) || 30 })} aria-label="Days" />
                days
              </>
            )}
            {segment.kind === "channel" && (
              <select className="guma-field h-9 w-44" value={segment.channel} onChange={(e) => setSegment({ ...segment, channel: e.target.value })} aria-label="Channel">
                {["tiktok", "facebook", "instagram", "messenger", "shopee", "lazada", "pos"].map((c) => (
                  <option key={c} value={c}>
                    {c === "pos" ? "In store (POS)" : c[0]!.toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto text-sm" data-testid="campaign-reach">
              {preview ? (
                <>
                  <strong>{preview.count}</strong> buyer{preview.count === 1 ? "" : "s"}
                  <span className="text-xs text-muted-foreground"> · {preview.consented} said yes to texts in total</span>
                </>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
            </span>
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>Message — {"{name}"} becomes the buyer&apos;s first name; your shop link is added</span>
            <span className={chars > 300 ? "text-red-300" : ""}>{chars}/300</span>
          </div>
          <textarea className="guma-field min-h-[84px] py-2" value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} aria-label="Message" />
        </div>
        {preview?.preview && (
          <div className="rounded-xl bg-white/[0.04] p-3 text-sm">
            <p className="mb-1 text-xs text-muted-foreground">
              What {preview.sample[0] ?? "a buyer"} gets · {preview.segments} SMS credit{preview.segments === 1 ? "" : "s"} each
              {preview.count ? ` · about ${(preview.segments ?? 1) * preview.count} in total` : ""}
            </p>
            <p className="whitespace-pre-wrap break-words font-mono text-xs" data-testid="campaign-preview">
              {preview.preview}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Send now
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
          </label>
          {when === "later" && <input type="datetime-local" className="guma-field h-9 w-56" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Send at" />}
          <span className="text-xs text-muted-foreground">Between 9 PM and 8 AM it waits until 8 AM.</span>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !smsReady || !preview?.count || body.trim().length < 5} onClick={() => void submit(true)} data-testid="campaign-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {when === "later" ? "Schedule" : `Send to ${preview?.count ?? 0}`}
          </Button>
          <Button type="button" variant="secondary" disabled={busy || body.trim().length < 5} onClick={() => void submit(false)}>
            Save draft
          </Button>
        </div>
      </div>
    </Card>
  );
}
