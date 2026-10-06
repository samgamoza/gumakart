"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, Link2, Loader2, MessageCircle, Package, RotateCcw, Search, Send, Sparkles, X } from "lucide-react";
import { Button, Card, formatPrice } from "@gumakart/ui";

/**
 * Phase 13 — Messenger & Instagram chats. Reply, send a product card or a checkout link
 * (tagged so the order shows here), mark done. Ready to hook up: without Meta keys the
 * page explains what's needed; in local/dev a demo Page lets you try it.
 */

type Platform = "messenger" | "instagram";

interface ThreadRow {
  id: string;
  accountName: string;
  platform: Platform;
  buyerName: string | null;
  lastMessageAt: string;
  lastPreview: string | null;
  unread: number;
  status: "open" | "done";
  canReply: boolean;
  orders: number;
}

interface Message {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string;
  payload: { title?: string; price?: number; url?: string; imageUrl?: string | null } | null;
  status: string;
  error: string | null;
  sentByName: string | null;
  createdAt: string;
}

interface ThreadDetail extends ThreadRow {
  lastInboundAt: string | null;
  messages: Message[];
  linkedOrders: Array<{ id: string; orderNumber: string; total: number; orderState: string | null; createdAt: string }>;
}

interface ListData {
  ok: boolean;
  error?: string;
  threads: ThreadRow[];
  accounts: Array<{ id: string; platform: Platform; name: string; status: string }>;
  mode: "live" | "demo" | "off";
}

interface PickProduct {
  id: string;
  title: string;
  price: number;
  imageUrl: string | null;
  hasOptions?: boolean;
  variants?: Array<{ id: string; title: string; price: number }>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "No connection. Try again." } as T & { ok: boolean; error?: string };
  }
}

const PLATFORM: Record<Platform, { label: string; dot: string }> = {
  messenger: { label: "Messenger", dot: "bg-sky-500" },
  instagram: { label: "Instagram", dot: "bg-pink-500" },
};

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function SocialInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("t");
  const [list, setList] = useState<ListData | null>(null);
  const [status, setStatus] = useState<"open" | "done" | "all">("open");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const d = await call<ListData>(`/api/inbox?status=${status}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
    if (d.ok) {
      setList(d);
      setError(null);
    } else setError(d.error ?? "Could not load chats.");
  }, [status, q]);

  useEffect(() => {
    void loadList();
    const t = window.setInterval(() => void loadList(), 10_000);
    return () => window.clearInterval(t);
  }, [loadList]);

  const open = (id: string | null) => router.replace(id ? `/inbox?t=${id}` : "/inbox", { scroll: false });

  if (!list) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading chats…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ModeBanner mode={list.mode} accounts={list.accounts.length} onSimulated={(id) => { void loadList(); open(id); }} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <Card className={`p-0 ${selected ? "hidden lg:block" : ""}`}>
          <div className="space-y-2 border-b border-white/10 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input className="guma-field h-10 pl-9" placeholder="Search name or message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
            </div>
            <div className="flex gap-1 text-xs">
              {(["open", "done", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-full px-3 py-1 font-medium ${status === s ? "bg-violet-600 text-white" : "bg-white/5 text-muted-foreground"}`}
                >
                  {s === "open" ? "To answer" : s === "done" ? "Done" : "All"}
                </button>
              ))}
            </div>
          </div>
          {list.threads.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {list.accounts.length === 0 ? "Connect your Facebook Page to see Messenger and Instagram chats here." : "No chats here."}
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-white/10 overflow-y-auto" data-testid="inbox-threads">
              {list.threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => open(t.id)}
                    className={`flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-white/[0.04] ${selected === t.id ? "bg-violet-500/10" : ""}`}
                  >
                    <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
                      {(t.buyerName ?? "?").slice(0, 1).toUpperCase()}
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b1020] ${PLATFORM[t.platform].dot}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${t.unread ? "font-bold" : "font-medium"}`}>{t.buyerName ?? "Buyer"}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{ago(t.lastMessageAt)}</span>
                      </span>
                      <span className={`block truncate text-xs ${t.unread ? "text-foreground" : "text-muted-foreground"}`}>{t.lastPreview}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>{PLATFORM[t.platform].label}</span>
                        {t.orders > 0 && <span className="rounded-full bg-emerald-500/15 px-1.5 text-emerald-300">{t.orders} order{t.orders === 1 ? "" : "s"}</span>}
                        {!t.canReply && <span className="rounded-full bg-white/10 px-1.5">24h passed</span>}
                      </span>
                    </span>
                    {t.unread > 0 && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-violet-400" aria-label="Unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className={selected ? "" : "hidden lg:block"}>
          {selected ? (
            <Conversation key={selected} threadId={selected} onBack={() => open(null)} onChanged={() => void loadList()} />
          ) : (
            <Card className="flex h-full min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
              <MessageCircle className="mr-2 h-4 w-4" /> Pick a chat
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeBanner({ mode, accounts, onSimulated }: { mode: ListData["mode"]; accounts: number; onSimulated: (threadId: string) => void }) {
  const [text, setText] = useState("Hi! Available pa po ba ito? Magkano shipping sa Cebu?");
  const [platform, setPlatform] = useState<Platform>("messenger");
  const [busy, setBusy] = useState(false);
  if (mode === "live" && accounts > 0) return null;
  if (mode === "off" || (mode === "live" && accounts === 0)) {
    return (
      <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-sm">
        {mode === "off" ? (
          <>
            <p className="font-semibold">Messenger & Instagram — malapit na</p>
            <p className="text-muted-foreground">Guma Kart is finishing Meta&apos;s app review. Once approved, connect your Facebook Page once and every Messenger and Instagram DM lands here.</p>
          </>
        ) : (
          <p>
            <Link href="/channels" className="font-semibold text-violet-300 underline">
              Connect your Facebook Page
            </Link>{" "}
            to answer Messenger and Instagram here.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-end" data-testid="inbox-demo">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-200">Demo mode — Meta isn&apos;t connected on this server</p>
        <p className="text-xs text-muted-foreground">Pretend a buyer messaged your Page to try replying and sending links. Replies are recorded as &ldquo;test&rdquo;, not sent.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="guma-field h-9 w-36" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} aria-label="Platform">
            <option value="messenger">Messenger</option>
            <option value="instagram">Instagram</option>
          </select>
          <input className="guma-field h-9 min-w-0 flex-1 basis-48" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buyer message" />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true);
          const r = await call<{ threadId: string }>("/api/inbox/simulate", { method: "POST", body: JSON.stringify({ platform, text, buyer: Math.floor(Math.random() * 3) }) });
          setBusy(false);
          if (r.ok) onSimulated(r.threadId);
        }}
        data-testid="inbox-simulate"
      >
        Simulate buyer message
      </Button>
    </div>
  );
}

function Conversation({ threadId, onBack, onChanged }: { threadId: string; onBack: () => void; onChanged: () => void }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<null | "product" | "link">(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Phase 26: AI reply suggestions (fill the box; the seller edits and sends).
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  async function suggestReplies() {
    setSuggesting(true);
    setError(null);
    const d = await call<{ replies: string[] }>(`/api/inbox/${threadId}/suggest-replies`, { method: "POST" });
    setSuggesting(false);
    if (d.ok) setSuggestions(d.replies);
    else setError(d.error ?? "Couldn't suggest replies.");
  }

  const load = useCallback(async () => {
    const d = await call<{ thread: ThreadDetail }>(`/api/inbox/${threadId}`);
    if (d.ok) {
      setThread(d.thread);
      setError(null);
    } else setError(d.error ?? "Could not load the chat.");
  }, [threadId]);

  useEffect(() => {
    void load().then(onChanged);
    const t = window.setInterval(() => void load(), 8_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [count]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await call<{ mock?: boolean }>(`/api/inbox/${threadId}/messages`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Not sent.");
    await load();
    onChanged();
    return r.ok;
  }

  if (!thread) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {error ?? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </span>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex min-h-[60vh] flex-col p-0">
      <div data-testid="inbox-conversation" className="contents">
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <button type="button" className="rounded-lg p-1.5 hover:bg-white/10 lg:hidden" onClick={onBack} aria-label="Back to chats">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{thread.buyerName ?? "Buyer"}</p>
          <p className="text-xs text-muted-foreground">
            {PLATFORM[thread.platform].label} · {thread.accountName}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={async () => {
            await call(`/api/inbox/${threadId}`, { method: "PATCH", body: JSON.stringify({ status: thread.status === "open" ? "done" : "open" }) });
            await load();
            onChanged();
          }}
        >
          {thread.status === "open" ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Done
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" /> Reopen
            </>
          )}
        </Button>
      </div>

      {thread.linkedOrders.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Orders from this chat:</span>
          {thread.linkedOrders.map((o) => (
            <Link key={o.id} href={`/orders?q=${encodeURIComponent(o.orderNumber)}`} className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300 hover:underline">
              #{o.orderNumber} · {formatPrice(o.total)}
            </Link>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "55vh" }}>
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-violet-600 text-white" : "bg-white/10"}`}>
              {m.kind === "product" && m.payload?.title ? (
                <div className="mb-1 overflow-hidden rounded-xl bg-white text-black">
                  <div className="p-2">
                    <p className="text-sm font-semibold">{m.payload.title}</p>
                    {typeof m.payload.price === "number" && <p className="text-xs">{formatPrice(m.payload.price)}</p>}
                    <p className="mt-1 rounded-lg bg-violet-600 py-1 text-center text-xs font-semibold text-white">Order na</p>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              <p className={`mt-0.5 text-[10px] ${m.direction === "out" ? "text-violet-100/80" : "text-muted-foreground"}`}>
                {new Date(m.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                {m.direction === "out" && m.sentByName ? ` · ${m.sentByName}` : ""}
                {m.status === "mock" ? " · test (not sent)" : ""}
                {m.status === "failed" ? ` · not sent: ${m.error ?? "error"}` : ""}
              </p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <p className="px-3 text-sm text-red-400">{error}</p>}
      {thread.canReply ? (
        <div className="space-y-2 border-t border-white/10 p-3">
          <div className="flex gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium" onClick={() => setPicker("product")} data-testid="inbox-send-product">
              <Package className="h-3.5 w-3.5" /> Product
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium" onClick={() => setPicker("link")}>
              <Link2 className="h-3.5 w-3.5" /> Checkout link
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200"
              onClick={() => void suggestReplies()}
              disabled={suggesting}
              data-testid="inbox-suggest"
            >
              {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest replies
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5" data-testid="inbox-suggestions">
              {suggestions.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setText(r);
                    setSuggestions([]);
                  }}
                  className="rounded-xl border border-violet-400/20 bg-violet-500/5 px-3 py-2 text-left text-xs text-slate-200 hover:bg-violet-500/15"
                >
                  {r}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              className="guma-field min-h-[44px] flex-1 py-2"
              rows={2}
              placeholder="Reply…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                  e.preventDefault();
                  void send({ type: "text", text }).then((ok) => ok && setText(""));
                }
              }}
              aria-label="Reply"
            />
            <Button type="button" disabled={busy || !text.trim()} onClick={() => void send({ type: "text", text }).then((ok) => ok && setText(""))} data-testid="inbox-send">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-2 border-t border-white/10 p-3 text-xs text-muted-foreground">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> More than 24 hours since the buyer&apos;s last message — Meta only delivers replies within 24 hours. You can reply when they message again.
        </p>
      )}
      {picker && (
        <SendPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onPick={async (body) => {
            const ok = await send(body);
            if (ok) setPicker(null);
          }}
          busy={busy}
        />
      )}
      </div>
    </Card>
  );
}

function SendPicker({ kind, onClose, onPick, busy }: { kind: "product" | "link"; onClose: () => void; onPick: (body: Record<string, unknown>) => void; busy: boolean }) {
  const [products, setProducts] = useState<PickProduct[] | null>(null);
  const [links, setLinks] = useState<Array<{ id: string; title: string; code: string; active: boolean }> | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (kind === "product") void call<{ products: PickProduct[] }>("/api/pos/products").then((d) => setProducts(d.ok ? d.products : []));
    else void call<{ links: Array<{ id: string; title: string; code: string; active: boolean }> }>("/api/checkout-links").then((d) => setLinks(d.ok ? d.links.filter((l) => l.active) : []));
  }, [kind]);
  const filtered = useMemo(() => (products ?? []).filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase())), [products, q]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[#0f1424] p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">{kind === "product" ? "Send a product" : "Send a checkout link"}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">The link is tagged with this chat, so the order shows here and in Channels.</p>
        {kind === "product" ? (
          <>
            <input className="guma-field mb-2 h-10" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            {!products ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ul className="divide-y divide-white/10" data-testid="inbox-product-list">
                {filtered.map((p) =>
                  p.hasOptions && (p.variants?.length ?? 0) > 1 ? (
                    (p.variants ?? []).map((v) => (
                      <li key={v.id}>
                        <button type="button" disabled={busy} className="flex w-full justify-between py-2 text-left text-sm" onClick={() => onPick({ type: "product", productId: p.id, variantId: v.id })}>
                          <span>
                            {p.title} <span className="text-muted-foreground">({v.title})</span>
                          </span>
                          <span>{formatPrice(v.price)}</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li key={p.id}>
                      <button type="button" disabled={busy} className="flex w-full justify-between py-2 text-left text-sm" onClick={() => onPick({ type: "product", productId: p.id })}>
                        <span>{p.title}</span>
                        <span>{formatPrice(p.price)}</span>
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
          </>
        ) : !links ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active checkout links.{" "}
            <Link className="text-violet-300 underline" href="/checkout-links">
              Make one
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-white/10">
            {links.map((l) => (
              <li key={l.id}>
                <button type="button" disabled={busy} className="flex w-full justify-between py-2 text-left text-sm" onClick={() => onPick({ type: "link", checkoutLinkId: l.id })}>
                  <span>{l.title}</span>
                  <span className="text-xs text-muted-foreground">/c/{l.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
