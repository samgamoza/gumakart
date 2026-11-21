"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Megaphone, Send, ShieldCheck, Sparkles, Star, X } from "lucide-react";
import { Button, Card } from "@gumakart/ui";

/**
 * AI suite Phase 4 — payday & restock broadcasts (Pro Live / Enterprise Vibe) + the BayanGo review
 * loop settings. Compliance is built in: Messenger / Instagram only reach buyers who messaged in the
 * last 24 h; WhatsApp buyers outside that window only get an approved template; ≤ 10 msg/s.
 */

type Tag = "VIP_REPEAT" | "PAYDAY_SHOPPER" | "INACTIVE_60D";
type Channel = "messenger" | "instagram" | "whatsapp";
type Kind = "payday" | "restock" | "custom";

interface Broadcast {
  id: string;
  name: string;
  channel: Channel;
  kind: Kind;
  segmentTags: Tag[];
  messageTemplate: string;
  waTemplateName: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt: string | null;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: string;
}

interface Preview {
  total: number;
  reachable: number;
  session: number;
  template: number;
  skipped: Record<string, number>;
}

interface Settings {
  reviewLoopEnabled: boolean;
  reviewVoucherAmount: number;
  reviewVoucherDays: number;
  waReviewTemplate: string | null;
  waTemplateLanguage: string;
}

const TAGS: Array<{ id: Tag; label: string; hint: string }> = [
  { id: "VIP_REPEAT", label: "VIP suki", hint: "3+ orders" },
  { id: "PAYDAY_SHOPPER", label: "Payday shoppers", hint: "mostly order on the 13th–17th / 28th–31st" },
  { id: "INACTIVE_60D", label: "Inactive 60 days", hint: "no order in 60+ days" },
];

const CHANNEL_LABEL: Record<Channel, string> = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp" };

const SKIP_LABEL: Record<string, string> = {
  outside_24h: "outside Meta's 24-hour window",
  no_chat: "never chatted on this channel",
  needs_template: "need an approved WhatsApp template",
  no_opt_in: "haven't opted in",
  opted_out: "opted out",
  no_number: "no number",
};

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return res.json().catch(() => ({ ok: false, error: "Network error" }));
}

export function BroadcastsView() {
  const params = useSearchParams();
  const [data, setData] = useState<{
    entitled: boolean;
    tierName: string;
    broadcasts: Broadcast[];
    segments: { total: number; tags: Record<Tag, number>; refreshedAt: string | null };
    payday: { show: boolean; period: string | null };
    channels: Channel[];
    drafts: Record<Kind, string>;
  } | null>(null);
  const [composer, setComposer] = useState<null | { kind: Kind }>(null);

  const load = useCallback(async () => {
    const j = await api<NonNullable<typeof data>>("/api/broadcasts");
    if (j.ok) setData(j);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const k = params.get("new");
    if (k === "payday" || k === "restock" || k === "custom") setComposer({ kind: k });
  }, [params]);

  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/[0.04]" />;

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="broadcasts">
      {!data.entitled && (
        <Card className="border-violet-200 bg-violet-50/60 dark:bg-primary/10">
          <p className="font-semibold">Payday & restock broadcasts are part of Pro Live and Enterprise Vibe.</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">You're on {data.tierName}. Upgrade in Settings → Subscription to message your VIP and payday buyers in one tap.</p>
        </Card>
      )}

      {data.entitled && data.payday.show && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:bg-amber-500/10">
          <Megaphone className="h-5 w-5 text-amber-600" />
          <p className="flex-1 text-sm font-medium">Payday bukas! Your payday shoppers are about to get paid — send them a reorder nudge.</p>
          <Button type="button" onClick={() => setComposer({ kind: "payday" })}>
            Create payday broadcast
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">Buyers with orders</p>
          <p className="text-2xl font-bold">{data.segments.total}</p>
          <p className="text-[11px] text-slate-400">{data.segments.refreshedAt ? `Updated ${new Date(data.segments.refreshedAt).toLocaleString("en-PH")}` : "Updates nightly"}</p>
        </Card>
        {TAGS.map((t) => (
          <Card key={t.id}>
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="text-2xl font-bold">{data.segments.tags[t.id]}</p>
            <p className="text-[11px] text-slate-400">{t.hint}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["payday", "restock", "custom"] as const).map((k) => (
          <Button key={k} type="button" variant={k === "payday" ? "primary" : "secondary"} disabled={!data.entitled} onClick={() => setComposer({ kind: k })}>
            {k === "payday" ? "New payday broadcast" : k === "restock" ? "New restock broadcast" : "New broadcast"}
          </Button>
        ))}
      </div>

      {composer && data.entitled && (
        <Composer
          kind={composer.kind}
          channels={data.channels}
          defaultDraft={data.drafts[composer.kind]}
          onClose={() => setComposer(null)}
          onDone={async () => {
            setComposer(null);
            await load();
          }}
        />
      )}

      <Card>
        <h3 className="mb-2 font-semibold">Broadcasts</h3>
        {data.broadcasts.length === 0 ? (
          <p className="text-sm text-slate-500">No broadcasts yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {data.broadcasts.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" data-testid="broadcast-row">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{b.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {CHANNEL_LABEL[b.channel]} · {b.kind} · {b.segmentTags.length ? b.segmentTags.join(", ") : "all buyers"}
                  </span>
                </span>
                <span className="text-xs text-slate-500">
                  {b.status === "draft" ? "Draft" : `${b.sent} sent · ${b.failed} failed · ${b.skipped} skipped / ${b.recipients}`}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize dark:bg-white/10">{b.status}</span>
                {(b.status === "draft" || b.status === "scheduled" || b.status === "sending") && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={async () => {
                      await api(`/api/broadcasts/${b.id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
                      await load();
                    }}
                  >
                    Cancel
                  </button>
                )}
                {b.status === "draft" && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-violet-600 hover:underline"
                    onClick={async () => {
                      const j = await api(`/api/broadcasts/${b.id}`, { method: "POST", body: JSON.stringify({ action: "queue" }) });
                      if (!j.ok) window.alert(j.error ?? "Couldn't send.");
                      await load();
                    }}
                  >
                    Send now
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Meta rules, built in: Messenger and Instagram promos only go to buyers who messaged you in the last 24 hours. WhatsApp buyers outside that window only get your approved Marketing template
        (body variables: {"{{1}}"} first name, {"{{2}}"} link). Up to 10 messages a second; buyers who replied STOP are skipped.
      </p>

      <ReviewLoopSettings />
    </div>
  );
}

function Composer({ kind, channels, defaultDraft, onClose, onDone }: { kind: Kind; channels: Channel[]; defaultDraft: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(kind === "payday" ? `Payday ${new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : kind === "restock" ? "Back in stock" : "");
  const [channel, setChannel] = useState<Channel>(channels.includes("whatsapp") ? "whatsapp" : channels[0] ?? "messenger");
  const [tags, setTags] = useState<Tag[]>(kind === "payday" ? ["PAYDAY_SHOPPER", "VIP_REPEAT"] : kind === "custom" ? [] : ["VIP_REPEAT"]);
  const [message, setMessage] = useState(defaultDraft);
  const [aiPolished, setAiPolished] = useState(false);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLanguage, setWaTemplateLanguage] = useState("en");
  const [products, setProducts] = useState<Array<{ id: string; title: string }>>([]);
  const [productId, setProductId] = useState<string>("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const productTitle = useMemo(() => products.find((p) => p.id === productId)?.title ?? null, [products, productId]);

  useEffect(() => {
    if (kind !== "restock") return;
    api<{ products: Array<{ id: string; title: string }> }>("/api/products").then((j) => (j.ok ? setProducts(j.products.slice(0, 300)) : null));
  }, [kind]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const j = await api<{ preview: Preview }>("/api/broadcasts", { method: "POST", body: JSON.stringify({ action: "preview", channel, segmentTags: tags, waTemplateName: waTemplateName || null }) });
      setPreview(j.ok ? j.preview : null);
    }, 300);
    return () => window.clearTimeout(t);
  }, [channel, tags, waTemplateName]);

  const body = () => ({
    name,
    channel,
    kind,
    segmentTags: tags,
    messageTemplate: message,
    waTemplateName: channel === "whatsapp" ? waTemplateName || null : null,
    waTemplateLanguage,
    productId: kind === "restock" ? productId || null : null,
    aiPolished,
  });

  async function save(andSend: boolean) {
    setBusy(andSend ? "send" : "save");
    setError(null);
    const created = await api<{ broadcast: Broadcast }>("/api/broadcasts", { method: "POST", body: JSON.stringify({ action: "create", broadcast: body() }) });
    if (!created.ok) {
      setBusy(null);
      setError(created.error ?? "Couldn't save.");
      return;
    }
    if (andSend) {
      const q = await api(`/api/broadcasts/${created.broadcast.id}`, { method: "POST", body: JSON.stringify({ action: "queue" }) });
      if (!q.ok) {
        setBusy(null);
        setError(`Saved as draft — ${q.error ?? "couldn't send"}`);
        return;
      }
    }
    setBusy(null);
    await onDone();
  }

  return (
    <Card className="space-y-3 border-violet-200 dark:border-primary/40">
      <span hidden data-testid="broadcast-composer" />
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{kind === "payday" ? "Payday broadcast" : kind === "restock" ? "Restock broadcast" : "Broadcast"}</h3>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1 hover:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
        </label>
        <label className="text-sm">
          Channel
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15">
            {(channels.length ? channels : (["messenger"] as Channel[])).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === "restock" && (
        <label className="block text-sm">
          Product that's back in stock
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15">
            <option value="">Pick a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <p className="text-sm">Who</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTags((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
              className={`rounded-full border px-3 py-1 text-xs ${tags.includes(t.id) ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200" : "border-slate-300 dark:border-white/15"}`}
            >
              {t.label}
            </button>
          ))}
          <span className="self-center text-xs text-slate-500">{tags.length ? "any of these" : "all buyers"}</span>
        </div>
      </div>
      <label className="block text-sm">
        Message <span className="text-xs text-slate-500">— {"{name}"} first name · {"{item}"} their last item · {"{link}"} their reorder link · {"{shop}"}</span>
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setAiPolished(false);
          }}
          rows={4}
          maxLength={1000}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("polish");
            const j = await api<{ text: string; servedBy: string }>("/api/broadcasts", { method: "POST", body: JSON.stringify({ action: "polish", draft: message, kind, channel, productTitle }) });
            setBusy(null);
            if (j.ok) {
              setMessage(j.text);
              setAiPolished(true);
            } else setError(j.error ?? "AI is busy — try again.");
          }}
        >
          {busy === "polish" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />} Polish in Taglish (AI)
        </Button>
        {aiPolished && <span className="text-xs text-emerald-600">AI-polished — check it before sending.</span>}
      </div>
      {channel === "whatsapp" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Approved WhatsApp template (for buyers outside 24 h)
            <input value={waTemplateName} onChange={(e) => setWaTemplateName(e.target.value.trim())} placeholder="e.g. payday_reorder" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
          </label>
          <label className="text-sm">
            Template language
            <input value={waTemplateLanguage} onChange={(e) => setWaTemplateLanguage(e.target.value.trim())} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
          </label>
        </div>
      )}
      {preview && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/[0.04]" data-testid="broadcast-preview">
          <p>
            <strong>{preview.reachable}</strong> of {preview.total} buyers can get this now
            {preview.template ? ` (${preview.session} chat message${preview.session === 1 ? "" : "s"}, ${preview.template} WhatsApp template)` : ""}.
          </p>
          {Object.entries(preview.skipped).length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Skipped: {Object.entries(preview.skipped).map(([k, v]) => `${v} ${SKIP_LABEL[k] ?? k}`).join(" · ")}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy !== null || !preview?.reachable} onClick={() => void save(true)}>
          {busy === "send" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Send to {preview?.reachable ?? 0}
        </Button>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void save(false)}>
          Save draft
        </Button>
      </div>
    </Card>
  );
}

function ReviewLoopSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<{ settings: Settings }>("/api/ai-suite/settings").then((j) => (j.ok ? setS(j.settings) : null));
  }, []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    const j = await api<{ settings: Settings }>("/api/ai-suite/settings", { method: "PATCH", body: JSON.stringify(patch) });
    if (j.ok) {
      setS(j.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }
  };
  return (
    <Card className="space-y-3">
      <span hidden data-testid="review-loop-settings" />
      <div className="flex items-center gap-2">
        <Star className="h-5 w-5 text-amber-500" />
        <h3 className="font-semibold">BayanGo review loop</h3>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
      <p className="text-sm text-slate-500">
        2 hours after BayanGo delivers, the buyer gets a chat message asking for 1–5 stars and a photo. Their answer is published as a verified review and they get a single-use thank-you voucher.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.reviewLoopEnabled} onChange={(e) => void save({ reviewLoopEnabled: e.target.checked })} /> Ask for reviews after delivery
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Voucher (₱, 0 = none)
          <input type="number" min={0} max={5000} defaultValue={s.reviewVoucherAmount} onBlur={(e) => void save({ reviewVoucherAmount: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
        </label>
        <label className="text-sm">
          Valid for (days)
          <input type="number" min={1} max={365} defaultValue={s.reviewVoucherDays} onBlur={(e) => void save({ reviewVoucherDays: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
        </label>
        <label className="text-sm">
          WhatsApp review template (optional)
          <input defaultValue={s.waReviewTemplate ?? ""} placeholder="order_review_request" onBlur={(e) => void save({ waReviewTemplate: e.target.value.trim() || null })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-white/15" />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Outside the 24-hour window Messenger can't message buyers; WhatsApp uses your approved Utility template ({"{{1}}"} name, {"{{2}}"} shop, {"{{3}}"} review link).
      </p>
    </Card>
  );
}
