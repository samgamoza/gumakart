"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, MessageCircle, RefreshCw, ShoppingBag, Unplug } from "lucide-react";
import { Button, Card, formatPrice } from "@gumakart/ui";

/**
 * Phase 13 — Channels: where sales come from, share links per channel (TikTok, Facebook,
 * Instagram, Messenger), the Messenger/Instagram connection, and Shopee/Lazada stock sync
 * + order import. Every integration is "ready to hook up": without keys it says so.
 */

type Mode = "live" | "demo" | "off";

interface Summary {
  ok: boolean;
  days: number;
  channels: Array<{ channel: string; orders: number; sales: number }>;
  shareLinks: Record<"facebook" | "instagram" | "tiktok" | "messenger", string>;
}

interface MarketAccount {
  id: string;
  platform: "shopee" | "lazada";
  name: string;
  status: string;
  syncStock: boolean;
  importOrders: boolean;
  lastStockPushAt: string | null;
  lastOrderPullAt: string | null;
  lastError: string | null;
  listings: number;
  linked: number;
}

interface ChannelsData {
  ok: boolean;
  error?: string;
  modes: { meta: Mode; shopee: Mode; lazada: Mode; email: "live" | "off" };
  social: Array<{ id: string; platform: "messenger" | "instagram"; name: string; status: string }>;
  marketplaces: MarketAccount[];
  imported: Array<{ id: string; orderNumber: string; salesChannel: string; externalOrderId: string; total: number; orderState: string | null; createdAt: string; staffNote: string | null }>;
}

interface Listing {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  externalStock: number | null;
  variantId: string | null;
  variantLabel: string | null;
  gumaStock: number | null;
  lastPushedQty: number | null;
  pushError: string | null;
}

const LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  tiktok: "TikTok",
  shopee: "Shopee",
  lazada: "Lazada",
  pos: "In store (POS)",
  direct: "Direct / other links",
  other: "Other",
};

const COLOR: Record<string, string> = {
  facebook: "bg-blue-500",
  instagram: "bg-pink-500",
  messenger: "bg-sky-400",
  tiktok: "bg-slate-200",
  shopee: "bg-orange-500",
  lazada: "bg-indigo-500",
  pos: "bg-emerald-500",
  direct: "bg-violet-400",
  other: "bg-slate-500",
};

async function call<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "No connection." } as T & { ok: boolean; error?: string };
  }
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* older browsers: the link is visible to copy by hand */
      }
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    },
  };
}

const NOTICES: Record<string, string> = {
  "meta=demo": "Demo Page and Instagram connected (test mode — nothing is sent to Meta).",
  "meta=connected": "Facebook Page connected. New Messenger and Instagram messages show in Chats.",
  "meta=off": "Messenger & Instagram aren't available yet — Guma Kart is finishing Meta's app review.",
  "meta=error": "Couldn't connect to Facebook. Try again.",
  "meta=cancelled": "Facebook connection cancelled.",
  "shopee=demo": "Demo Shopee shop connected — its listings mirror your products.",
  "lazada=demo": "Demo Lazada shop connected — its listings mirror your products.",
  "shopee=connected": "Shopee connected. Link any listings that weren't matched by SKU.",
  "lazada=connected": "Lazada connected. Link any listings that weren't matched by SKU.",
  "shopee=off": "Shopee sync isn't available yet — waiting for Shopee Open Platform approval.",
  "lazada=off": "Lazada sync isn't available yet — waiting for Lazada Open Platform approval.",
  "shopee=error": "Couldn't connect Shopee. Try again.",
  "lazada=error": "Couldn't connect Lazada. Try again.",
  "shopee=taken": "That Shopee shop is connected to another Guma Kart shop.",
  "lazada=taken": "That Lazada shop is connected to another Guma Kart shop.",
};

export function ChannelsView() {
  const params = useSearchParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [data, setData] = useState<ChannelsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([call<Summary>("/api/channels/summary"), call<ChannelsData>("/api/channels")]);
    if (s.ok) setSummary(s);
    if (d.ok) setData(d);
    else setError(d.error ?? "Could not load channels.");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const notice = Object.entries(NOTICES).find(([k]) => {
    const [key, value] = k.split("=");
    return params.get(key!) === value;
  })?.[1];

  if (!data || !summary) {
    return error ? (
      <p className="text-sm text-red-400">{error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const max = Math.max(...summary.channels.map((c) => c.sales), 1);
  const total = summary.channels.reduce((s, c) => s + c.sales, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {notice && <p className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-sm" data-testid="channels-notice">{notice}</p>}

      <Card className="p-5">
        <h2 className="font-semibold">Where your sales come from</h2>
        <p className="text-sm text-muted-foreground">Last {summary.days} days · {formatPrice(total)} total. Tag your links below so every sale is counted to the right place.</p>
        {summary.channels.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No sales yet.</p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="channel-sales">
            {summary.channels.map((c) => (
              <li key={c.channel} className="text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{LABEL[c.channel] ?? c.channel}</span>
                  <span>
                    {formatPrice(c.sales)} <span className="text-muted-foreground">· {c.orders} order{c.orders === 1 ? "" : "s"}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-white/5">
                  <div className={`h-2 rounded-full ${COLOR[c.channel] ?? "bg-slate-400"}`} style={{ width: `${Math.max((c.sales / max) * 100, 2)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Share links per channel</h2>
        <p className="text-sm text-muted-foreground">
          Same shop, tagged with where you post it. Put the TikTok one in your bio and video captions; product and checkout links have the same buttons.
        </p>
        <ul className="mt-3 space-y-2">
          {(["tiktok", "facebook", "instagram", "messenger"] as const).map((ch) => (
            <li key={ch} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{LABEL[ch]}</span>
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white/5 px-2 py-1.5 text-xs">{summary.shareLinks[ch]}</code>
              <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs" onClick={() => void copy(ch, summary.shareLinks[ch])}>
                {copied === ch ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === ch ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageCircle className="h-4 w-4" /> Messenger & Instagram
            </h2>
            <p className="text-sm text-muted-foreground">Answer DMs in Guma Kart, send product cards and checkout links — orders show in the chat they came from.</p>
          </div>
          <ModeTag mode={data.modes.meta} />
        </div>
        {data.social.length > 0 ? (
          <ul className="mt-3 divide-y divide-white/10 text-sm" data-testid="social-accounts">
            {data.social.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {a.name}
                  <span className="block text-xs text-muted-foreground">
                    {a.platform === "instagram" ? "Instagram" : "Messenger"} · {a.status === "mock" ? "demo" : a.status}
                  </span>
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-300"
                  onClick={async () => {
                    if (!window.confirm(`Disconnect ${a.name}? Chats stay; new messages stop.`)) return;
                    await call(`/api/channels/meta/${a.id}`, { method: "DELETE" });
                    await load();
                  }}
                >
                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {data.modes.meta !== "off" && (
            <a href="/api/channels/meta/connect" className="inline-flex h-9 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white" data-testid="connect-meta">
              {data.social.length ? "Connect another Page" : data.modes.meta === "demo" ? "Connect demo Page" : "Connect Facebook Page"}
            </a>
          )}
          <Link href="/inbox" className="inline-flex h-9 items-center rounded-xl border border-white/15 px-4 text-sm">
            Open Chats
          </Link>
        </div>
        {data.modes.meta === "off" && <p className="mt-2 text-xs text-muted-foreground">Malapit na — waiting for Meta&apos;s app review. Nothing to do on your side yet.</p>}
      </Card>

      {(["shopee", "lazada"] as const).map((platform) => (
        <MarketplaceCard key={platform} platform={platform} mode={data.modes[platform]} accounts={data.marketplaces.filter((m) => m.platform === platform)} reload={load} />
      ))}

      {data.imported.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Recent marketplace orders</h2>
          <ul className="mt-2 divide-y divide-white/10 text-sm" data-testid="imported-orders">
            {data.imported.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  #{o.orderNumber} · {LABEL[o.salesChannel] ?? o.salesChannel} {o.externalOrderId}
                  <span className="block text-xs text-muted-foreground">
                    {when(o.createdAt)}
                    {o.orderState === "cancelled" ? " · cancelled, restocked" : ""}
                    {o.staffNote?.includes("Oversold") ? " · oversold — recount" : ""}
                  </span>
                </span>
                <span>{formatPrice(o.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Mail className="h-4 w-4" /> Email receipts
        </h2>
        <p className="text-sm text-muted-foreground">
          Buyers who type an email get each order update by email too (free), and the register can email a receipt.{" "}
          {data.modes.email === "off" ? "Email sending isn't connected yet; it starts once it is. " : ""}
          <Link href="/automations" className="text-violet-300 underline">
            Turn it on or off in Auto SMS
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

function ModeTag({ mode }: { mode: Mode }) {
  const style = mode === "live" ? "bg-emerald-500/15 text-emerald-300" : mode === "demo" ? "bg-amber-500/15 text-amber-200" : "bg-white/10 text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{mode === "live" ? "Available" : mode === "demo" ? "Demo mode" : "Malapit na"}</span>;
}

function MarketplaceCard({ platform, mode, accounts, reload }: { platform: "shopee" | "lazada"; mode: Mode; accounts: MarketAccount[]; reload: () => Promise<void> }) {
  const name = platform === "shopee" ? "Shopee" : "Lazada";
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingBag className="h-4 w-4" /> {name}
          </h2>
          <p className="text-sm text-muted-foreground">One stock count: your Guma Kart stock is pushed to linked {name} listings, and paid {name} orders come in here and take stock.</p>
        </div>
        <ModeTag mode={mode} />
      </div>
      {accounts.map((a) => (
        <MarketplaceAccountPanel key={a.id} account={a} name={name} reload={reload} />
      ))}
      {mode !== "off" && accounts.length === 0 && (
        <a href={`/api/channels/marketplaces/${platform}/connect`} className="mt-3 inline-flex h-9 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white" data-testid={`connect-${platform}`}>
          {mode === "demo" ? `Connect demo ${name} shop` : `Connect ${name}`}
        </a>
      )}
      {mode === "off" && <p className="mt-2 text-xs text-muted-foreground">Malapit na — waiting for {name} Open Platform approval.</p>}
    </Card>
  );
}

function MarketplaceAccountPanel({ account, name, reload }: { account: MarketAccount; name: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [variants, setVariants] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    const d = await call<{ listings: Listing[] }>(`/api/channels/marketplaces/accounts/${account.id}`);
    if (d.ok) setListings(d.listings);
  }, [account.id]);

  useEffect(() => {
    if (!open) return;
    void loadListings();
    void call<{ products: Array<{ id: string; title: string; hasOptions?: boolean; variants?: Array<{ id: string; title: string }> }> }>("/api/pos/products").then((d) => {
      if (!d.ok) return;
      setVariants(
        d.products.flatMap((p) => (p.hasOptions ? (p.variants ?? []).map((v) => ({ id: v.id, label: `${p.title} (${v.title})` })) : (p.variants ?? []).slice(0, 1).map((v) => ({ id: v.id, label: p.title }))))
      );
    });
  }, [open, loadListings]);

  const demo = account.status === "mock";
  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3 text-sm" data-testid={`market-${account.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium">{account.name}</span>
          <span className="block text-xs text-muted-foreground">
            {account.linked}/{account.listings} listings linked · stock pushed {when(account.lastStockPushAt)}
            {demo ? " · demo" : ` · orders checked ${when(account.lastOrderPullAt)}`}
          </span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("sync");
              const r = await call<{ summary: { pushed: number; imported: number; cancelled: number } }>(`/api/channels/marketplaces/accounts/${account.id}/sync`, { method: "POST" });
              setBusy(null);
              setMsg(r.ok ? `Stock sent to ${r.summary.pushed} listing(s), ${r.summary.imported} new order(s).` : (r.error ?? "Sync failed."));
              await reload();
              if (open) await loadListings();
            }}
            data-testid="market-sync"
          >
            {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
          </Button>
          {demo && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("sim");
                const r = await call<{ externalOrderId: string; result: { status: string; orderNumber?: string } }>(`/api/channels/marketplaces/accounts/${account.id}/simulate-order`, { method: "POST", body: "{}" });
                setBusy(null);
                setMsg(r.ok ? `Test ${name} order ${r.externalOrderId} imported as #${r.result.orderNumber ?? "—"}; stock taken here.` : (r.error ?? "Failed."));
                await reload();
                if (open) await loadListings();
              }}
              data-testid="market-simulate"
            >
              Simulate {name} order
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide listings" : "Listings"}
          </Button>
        </div>
      </div>
      {account.lastError && <p className="mt-2 text-xs text-amber-300">{account.lastError}</p>}
      {msg && <p className="mt-2 text-xs text-emerald-300" data-testid="market-msg">{msg}</p>}
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        {(["syncStock", "importOrders"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={account[key]}
              onChange={async (e) => {
                await call(`/api/channels/marketplaces/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ [key]: e.target.checked }) });
                await reload();
              }}
            />
            {key === "syncStock" ? "Push my stock to listings" : "Import paid orders"}
          </label>
        ))}
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-red-300"
          onClick={async () => {
            if (!window.confirm(`Disconnect ${account.name}? Stock stops syncing.`)) return;
            await call(`/api/channels/marketplaces/accounts/${account.id}`, { method: "DELETE" });
            await reload();
          }}
        >
          Disconnect
        </button>
      </div>
      {open && (
        <div className="mt-3 overflow-x-auto">
          {!listings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : listings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No listings yet — press Sync now.</p>
          ) : (
            <table className="w-full min-w-[560px] text-xs" data-testid="market-listings">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">{name} listing</th>
                  <th className="py-1 font-medium">Linked to</th>
                  <th className="py-1 text-right font-medium">Guma stock</th>
                  <th className="py-1 text-right font-medium">On {name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 pr-2">
                      {l.title}
                      {l.sku ? <span className="block text-muted-foreground">SKU {l.sku}</span> : null}
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        className="guma-field h-8 text-xs"
                        value={l.variantId ?? ""}
                        onChange={async (e) => {
                          await call(`/api/channels/marketplaces/listings/${l.id}`, { method: "PATCH", body: JSON.stringify({ variantId: e.target.value || null }) });
                          await loadListings();
                          await reload();
                        }}
                        aria-label={`Link ${l.title}`}
                      >
                        <option value="">Not linked</option>
                        {l.variantId && !variants.some((v) => v.id === l.variantId) && <option value={l.variantId}>{l.variantLabel}</option>}
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 text-right">{l.gumaStock ?? "—"}</td>
                    <td className={`py-1.5 text-right ${l.pushError ? "text-red-300" : l.gumaStock !== null && l.lastPushedQty !== l.gumaStock ? "text-amber-300" : ""}`}>
                      {l.pushError ? "error" : (l.lastPushedQty ?? l.externalStock ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
