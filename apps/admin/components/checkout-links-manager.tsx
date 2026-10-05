"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Minus,
  Plus,
  Power,
  QrCode,
  Share2,
  X,
} from "lucide-react";
import { Card, formatPrice } from "@gumakart/ui";
import { productImageSrc } from "@/lib/product-image";
import { SharePostImageButton } from "@/components/share-post-image";

// ─── Types (mirror the API) ──────────────────────────────────────────────────

type ShareChannel = "facebook" | "instagram" | "tiktok" | "messenger" | "other";
type DeliveryMode = "both" | "delivery" | "pickup";
type PaymentMethod = "gcash" | "paymaya" | "cod" | "bank" | "qrph" | "card";
type LinkStatus = "live" | "off" | "expired" | "sold_out";

interface LinkItem {
  productId: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: string;
  imageUrl: string | null;
  stockQty: number | null;
  productActive: boolean;
}

export interface CheckoutLink {
  id: string;
  code: string;
  title: string;
  shareChannel: ShareChannel | null;
  allowQuantityEdit: boolean;
  deliveryMode: DeliveryMode;
  paymentMethods: PaymentMethod[] | null;
  expiresAt: string | null;
  maxOrders: number | null;
  active: boolean;
  status: LinkStatus;
  viewCount: number;
  startCount: number;
  orderCount: number;
  salesTotal: number;
  createdAt: string;
  items: LinkItem[];
}

interface ShopOptions {
  paymentMethods: Array<{ id: PaymentMethod; label: string; needsSetup: boolean }>;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
}

interface ProductRow {
  id: string;
  title: string;
  basePrice: string;
  status: string;
  stockQty: number;
  imageUrl: string | null;
  hasOptions?: boolean;
}

interface VariantChoice {
  id: string;
  title: string;
  price: string;
  stockQty: number;
}

// ─── Copy ────────────────────────────────────────────────────────────────────

const CHANNELS: Array<{ id: ShareChannel; label: string; tip: string }> = [
  { id: "facebook", label: "Facebook", tip: "Paste it in your post, or reply to comments with it." },
  { id: "messenger", label: "Messenger", tip: "Send it in chat when a buyer says “mine” or asks how to order." },
  { id: "instagram", label: "Instagram", tip: "Put it in your bio or a Story link sticker, or send it in DMs." },
  { id: "tiktok", label: "TikTok", tip: "Put it in your bio, or pin it in comments and live chat." },
  { id: "other", label: "Other", tip: "Paste it anywhere your buyers are: group chats, Viber, SMS." },
];

const DELIVERY_CHOICES: Array<{ id: DeliveryMode; label: string }> = [
  { id: "both", label: "Delivery or pickup" },
  { id: "delivery", label: "Delivery only" },
  { id: "pickup", label: "Pickup only" },
];

const STATUS_STYLE: Record<LinkStatus, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  off: { label: "Off", className: "bg-white/5 text-slate-400 border-white/10" },
  expired: { label: "Ended", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  sold_out: { label: "Order limit reached", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

function channelLabel(id: ShareChannel | null): string | null {
  return CHANNELS.find((c) => c.id === id)?.label ?? null;
}

/** Buyer-facing text: product names, never the seller's private link name. */
function shareCaption(link: CheckoutLink, url: string): string {
  const what = link.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}`).join(" + ");
  return `${what}\nOrder here, no app or account needed: ${url}`;
}

// ─── Small UI bits ───────────────────────────────────────────────────────────

const chip =
  "rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const chipOn = "border-primary/60 bg-primary/15 text-foreground";
const chipOff = "border-white/10 text-slate-300 hover:bg-white/[0.05]";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/[0.06]";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }, []);
  return { copied, copy };
}

function Thumbs({ items }: { items: LinkItem[] }) {
  const shown = items.slice(0, 3);
  return (
    <div className="flex flex-none -space-x-3">
      {shown.map((item, i) => (
        <div
          key={`${item.productId}:${i}`}
          className="h-12 w-12 overflow-hidden rounded-xl border-2 border-card bg-white/5"
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={productImageSrc(item.imageUrl)} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function CheckoutLinksManager() {
  const searchParams = useSearchParams();
  const preselectProduct = searchParams.get("product");

  const [links, setLinks] = useState<CheckoutLink[]>([]);
  const [options, setOptions] = useState<ShopOptions | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(Boolean(preselectProduct));
  const [justCreated, setJustCreated] = useState<CheckoutLink | null>(null);
  const [qrLink, setQrLink] = useState<CheckoutLink | null>(null);
  const [shareLink, setShareLink] = useState<CheckoutLink | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/checkout-links", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Could not load your links.");
      setLinks(data.links);
      setOptions(data.options);
      setBaseUrl(data.linkBaseUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your links.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const urlOf = useCallback((link: CheckoutLink) => `${baseUrl}${link.code}`, [baseUrl]);

  async function toggleActive(link: CheckoutLink) {
    setBusyId(link.id);
    try {
      const res = await fetch(`/api/checkout-links/${link.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !link.active }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setLinks((all) => all.map((l) => (l.id === link.id ? data.link : l)));
    } catch {
      setError("Couldn't update that link. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  const totals = useMemo(
    () => ({
      live: links.filter((l) => l.status === "live").length,
      orders: links.reduce((n, l) => n + l.orderCount, 0),
      sales: links.reduce((n, l) => n + l.salesTotal, 0),
    }),
    [links]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sell where your buyers already are. Make a link, paste it in your Facebook post, Instagram bio,
          TikTok or Messenger chat, and buyers order on one page. No app, no account.
        </p>
        {!creating && (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setJustCreated(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New checkout link
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {creating && options && (
        <CreateLinkPanel
          options={options}
          preselectProduct={preselectProduct}
          onCancel={() => setCreating(false)}
          onCreated={(link) => {
            setLinks((all) => [link, ...all]);
            setCreating(false);
            setJustCreated(link);
          }}
        />
      )}

      {justCreated && (
        <Card className="border-emerald-500/30 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Your link is ready</p>
              <p className="mt-1 text-lg font-semibold">{justCreated.title}</p>
            </div>
            <button type="button" onClick={() => setJustCreated(null)} className="text-slate-400 hover:text-white" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <SharePanelBody link={justCreated} url={urlOf(justCreated)} onShowQr={() => setQrLink(justCreated)} />
        </Card>
      )}

      {!loading && links.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Live links", value: String(totals.live) },
            { label: "Orders from links", value: String(totals.orders) },
            { label: "Sales from links", value: formatPrice(totals.sales) },
          ].map((s) => (
            <Card key={s.label} className="p-3 sm:p-4">
              <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">{s.label}</p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl">{s.value}</p>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading your links…</p>
      ) : links.length === 0 && !creating ? (
        <Card className="p-10 text-center">
          <Link2 className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3 text-base font-semibold">Make your first checkout link</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Pick a product, choose how buyers pay and get it, then share the link in your post or chat.
            Orders show up in Orders, marked “Checkout link”.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> New checkout link
          </button>
        </Card>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const url = urlOf(link);
            const status = STATUS_STYLE[link.status];
            const channel = channelLabel(link.shareChannel);
            const missing = link.items.some((i) => !i.productActive);
            return (
              <Card key={link.id} className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Thumbs items={link.items} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold">{link.title}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                      {channel && (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
                          {channel}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {link.items
                        .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}`)
                        .join(" · ")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copy(link.id, url)}
                      className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-xs text-primary hover:underline"
                    >
                      {url.replace(/^https?:\/\//, "")}
                      {copied === link.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-none">
                    <button type="button" className={ghostBtn} onClick={() => void copy(link.id, url)}>
                      {copied === link.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied === link.id ? "Copied" : "Copy"}
                    </button>
                    <button type="button" className={ghostBtn} onClick={() => setShareLink(link)}>
                      <Share2 className="h-4 w-4" /> Share
                    </button>
                    <button type="button" className={ghostBtn} onClick={() => setQrLink(link)}>
                      <QrCode className="h-4 w-4" /> QR
                    </button>
                    <a className={ghostBtn} href={url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" /> Open
                    </a>
                    <button
                      type="button"
                      className={ghostBtn}
                      disabled={busyId === link.id}
                      onClick={() => void toggleActive(link)}
                    >
                      <Power className="h-4 w-4" /> {link.active ? "Turn off" : "Turn on"}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/5 pt-3 text-xs text-muted-foreground">
                  <span>
                    <b className="text-foreground">{link.viewCount}</b> views
                  </span>
                  <span>
                    <b className="text-foreground">{link.startCount}</b> started checkout
                  </span>
                  <span>
                    <b className="text-foreground">{link.orderCount}</b> orders
                  </span>
                  <span>
                    <b className="text-foreground">{formatPrice(link.salesTotal)}</b> sales
                  </span>
                  {link.expiresAt && <span>Ends {new Date(link.expiresAt).toLocaleDateString()}</span>}
                  {link.maxOrders && <span>Up to {link.maxOrders} orders</span>}
                  {missing && <span className="text-amber-300">A product in this link is unpublished</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {qrLink && <QrModal link={qrLink} url={urlOf(qrLink)} onClose={() => setQrLink(null)} />}
      {shareLink && (
        <Modal title={`Share “${shareLink.title}”`} onClose={() => setShareLink(null)}>
          <SharePanelBody link={shareLink} url={urlOf(shareLink)} onShowQr={() => setQrLink(shareLink)} />
        </Modal>
      )}
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

function CreateLinkPanel({
  options,
  preselectProduct,
  onCancel,
  onCreated,
}: {
  options: ShopOptions;
  preselectProduct: string | null;
  onCancel: () => void;
  onCreated: (link: CheckoutLink) => void;
}) {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [selected, setSelected] = useState<Map<string, number>>(
    () => new Map(preselectProduct ? [[preselectProduct, 1]] : [])
  );
  const [search, setSearch] = useState("");
  // Phase 9: products with sizes/colours need one variant picked per line.
  const [variantPick, setVariantPick] = useState<Map<string, string>>(() => new Map());
  const [variantLists, setVariantLists] = useState<Map<string, VariantChoice[]>>(() => new Map());
  const [channel, setChannel] = useState<ShareChannel | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMode>(options.pickupEnabled ? "both" : "delivery");
  const [payments, setPayments] = useState<Set<PaymentMethod>>(
    () => new Set(options.paymentMethods.map((m) => m.id))
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [allowQty, setAllowQty] = useState(true);
  const [endsOn, setEndsOn] = useState("");
  const [maxOrders, setMaxOrders] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setProducts(data.ok ? data.products : []))
      .catch(() => setProducts([]));
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (products ?? []).filter((p) => p.status !== "archived");
    const sorted = [...list].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
    return q ? sorted.filter((p) => p.title.toLowerCase().includes(q)) : sorted;
  }, [products, search]);

  const subtotal = useMemo(() => {
    let sum = 0;
    for (const [id, qty] of selected) {
      const p = products?.find((x) => x.id === id);
      const variant = variantLists.get(id)?.find((v) => v.id === variantPick.get(id));
      if (variant) sum += Number(variant.price) * qty;
      else if (p) sum += Number(p.basePrice) * qty;
    }
    return sum;
  }, [selected, products, variantLists, variantPick]);

  async function loadVariants(id: string) {
    if (variantLists.has(id)) return;
    try {
      const res = await fetch(`/api/products/${id}/variants`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; variants?: VariantChoice[] };
      const list = data.ok ? (data.variants ?? []) : [];
      setVariantLists((prev) => new Map(prev).set(id, list));
      const first = list.find((v) => v.stockQty > 0) ?? list[0];
      if (first) setVariantPick((prev) => (prev.has(id) ? prev : new Map(prev).set(id, first.id)));
    } catch {
      setVariantLists((prev) => new Map(prev).set(id, []));
    }
  }

  // A product preselected from the Products page may have options.
  useEffect(() => {
    for (const id of selected.keys()) {
      if (products?.find((p) => p.id === id)?.hasOptions) void loadVariants(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  function toggleProduct(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, 1);
      return next;
    });
    if (!selected.has(id) && products?.find((p) => p.id === id)?.hasOptions) void loadVariants(id);
  }

  function setQty(id: string, qty: number) {
    setSelected((prev) => new Map(prev).set(id, Math.max(1, Math.min(99, qty))));
  }

  function togglePayment(id: PaymentMethod) {
    setPayments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (selected.size === 0) return setError("Pick at least one product.");
    const missingPick = [...selected.keys()].find(
      (id) => products?.find((p) => p.id === id)?.hasOptions && !variantPick.get(id)
    );
    if (missingPick) {
      return setError(`Pick a size or option for ${products?.find((p) => p.id === missingPick)?.title ?? "the product"}.`);
    }
    if (payments.size === 0) return setError("Choose at least one way to pay.");
    setSaving(true);
    try {
      const expiresAt = endsOn ? new Date(`${endsOn}T23:59:59`).toISOString() : null;
      const res = await fetch("/api/checkout-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          items: [...selected].map(([productId, quantity]) => ({
            productId,
            quantity,
            variantId: variantPick.get(productId) ?? null,
          })),
          shareChannel: channel,
          allowQuantityEdit: allowQty,
          deliveryMode: delivery,
          paymentMethods: [...payments],
          expiresAt,
          maxOrders: maxOrders ? Number(maxOrders) : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Couldn't create the link.");
      onCreated(data.link);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setSaving(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <p className="text-base font-semibold">New checkout link</p>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white" aria-label="Cancel">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        {/* 1. Products */}
        <section>
          <p className="text-sm font-semibold">1. What are you selling?</p>
          <p className="text-xs text-muted-foreground">Pick one or more products. Prices come from the product.</p>
          {(products?.length ?? 0) > 6 && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-primary/40"
            />
          )}
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {products === null ? (
              <p className="text-sm text-muted-foreground">Loading products…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products yet. <Link className="text-primary underline" href="/products">Add a product</Link> first.
              </p>
            ) : (
              visible.map((p) => {
                const isActive = p.status === "active";
                const qty = selected.get(p.id);
                const on = qty !== undefined;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                      on ? "border-primary/50 bg-primary/10" : "border-white/10"
                    } ${isActive ? "" : "opacity-50"}`}
                  >
                    <button
                      type="button"
                      disabled={!isActive}
                      onClick={() => toggleProduct(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
                    >
                      <span
                        className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-white/20"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-white/5">
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={productImageSrc(p.imageUrl)} alt="" className="h-full w-full object-cover" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.hasOptions ? "From " : ""}
                          {formatPrice(Number(p.basePrice))} · {isActive ? `${p.stockQty} in stock` : "Draft, publish it first"}
                        </span>
                      </span>
                    </button>
                    {on && p.hasOptions && (
                      <select
                        value={variantPick.get(p.id) ?? ""}
                        onChange={(e) => setVariantPick((prev) => new Map(prev).set(p.id, e.target.value))}
                        aria-label={`Size or option for ${p.title}`}
                        className="h-9 max-w-[10rem] flex-none rounded-lg border border-white/10 bg-card px-2 text-sm"
                      >
                        {!variantLists.has(p.id) ? <option value="">Loading…</option> : null}
                        {(variantLists.get(p.id) ?? []).map((v) => (
                          <option key={v.id} value={v.id} disabled={v.stockQty <= 0}>
                            {v.title} · {formatPrice(Number(v.price))}
                            {v.stockQty <= 0 ? " · sold out" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {on && (
                      <div className="flex flex-none items-center gap-1 rounded-xl border border-white/10 p-0.5">
                        <button type="button" onClick={() => setQty(p.id, qty - 1)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Less">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                        <button type="button" onClick={() => setQty(p.id, qty + 1)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="More">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 2. Where */}
        <section>
          <p className="text-sm font-semibold">2. Where will you share it?</p>
          <p className="text-xs text-muted-foreground">So you can see which post or chat brings orders.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChannel(channel === c.id ? null : c.id)}
                className={`${chip} ${channel === c.id ? chipOn : chipOff}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {channel && <p className="mt-2 text-xs text-emerald-300">{CHANNELS.find((c) => c.id === channel)?.tip}</p>}
        </section>

        {/* 3. Delivery */}
        <section>
          <p className="text-sm font-semibold">3. How do buyers get it?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DELIVERY_CHOICES.map((d) => {
              const disabled = d.id !== "delivery" && !options.pickupEnabled;
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setDelivery(d.id)}
                  className={`${chip} ${delivery === d.id ? chipOn : chipOff}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {!options.pickupEnabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Pickup is off for your shop.{" "}
              <Link href="/settings/delivery-shipping" className="text-primary underline">
                Turn it on in Delivery settings
              </Link>
              .
            </p>
          )}
        </section>

        {/* 4. Payment */}
        <section>
          <p className="text-sm font-semibold">4. How can they pay?</p>
          {options.paymentMethods.length === 0 ? (
            <p className="mt-2 text-sm text-amber-300">
              No payment method is on yet.{" "}
              <Link href="/settings/payments" className="underline">
                Set up GCash, Maya or COD
              </Link>
              .
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {options.paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => togglePayment(m.id)}
                    className={`${chip} ${payments.has(m.id) ? chipOn : chipOff}`}
                  >
                    {payments.has(m.id) && <Check className="mr-1 inline h-3.5 w-3.5" />}
                    {m.label}
                  </button>
                ))}
              </div>
              {options.paymentMethods.some((m) => m.needsSetup && payments.has(m.id)) && (
                <p className="mt-2 text-xs text-amber-300">
                  Add your{" "}
                  {options.paymentMethods
                    .filter((m) => m.needsSetup && payments.has(m.id))
                    .map((m) => m.label)
                    .join(" and ")}{" "}
                  number in{" "}
                  <Link href="/settings/payments" className="underline">
                    Payment settings
                  </Link>{" "}
                  so buyers know where to send money.
                </p>
              )}
            </>
          )}
        </section>

        {/* More */}
        <section>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-300 hover:text-white"
          >
            <ChevronDown className={`h-4 w-4 transition ${moreOpen ? "rotate-180" : ""}`} /> More options
          </button>
          {moreOpen && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Link name (only you see this)</span>
                <input
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Payday sale post"
                  className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-primary/40"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
                <span>
                  Buyers can change quantity
                  <span className="block text-xs text-muted-foreground">Off = they buy exactly the amount you set.</span>
                </span>
                <input type="checkbox" checked={allowQty} onChange={(e) => setAllowQty(e.target.checked)} className="h-4 w-4 accent-primary" />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Stop taking orders after (optional)</span>
                <input
                  type="date"
                  min={today}
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-primary/40"
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">Maximum orders (optional)</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={maxOrders}
                  onChange={(e) => setMaxOrders(e.target.value.replace(/\D/g, ""))}
                  placeholder="No limit"
                  className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-primary/40"
                />
              </label>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 bg-white/[0.02] px-5 py-4">
        <p className="text-sm text-muted-foreground">
          {selected.size === 0
            ? "No products picked yet"
            : `${selected.size} product${selected.size > 1 ? "s" : ""} · ${formatPrice(subtotal)} before delivery`}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || selected.size === 0}
            onClick={() => void submit()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" /> {saving ? "Creating…" : "Create link"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Share / QR ──────────────────────────────────────────────────────────────

export function SharePanelBody({ link, url, onShowQr }: { link: CheckoutLink; url: string; onShowQr: () => void }) {
  const { copied, copy } = useCopy();
  const caption = shareCaption(link, url);
  const tip = CHANNELS.find((c) => c.id === link.shareChannel)?.tip ?? CHANNELS[4]!.tip;
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);

  const targets = [
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { label: "Messenger", href: `fb-messenger://share/?link=${encodeURIComponent(url)}`, mobileOnly: true },
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(caption)}` },
    { label: "Viber", href: `viber://forward?text=${encodeURIComponent(caption)}`, mobileOnly: true },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{url.replace(/^https?:\/\//, "")}</span>
        <button
          type="button"
          onClick={() => void copy("url", url)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
        >
          {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied === "url" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="text-sm text-emerald-300">{tip}</p>
      {/* Phase 13: the same link tagged per channel, so Channels can tell TikTok from Facebook sales. */}
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="link-channel-copies">
        <span className="text-muted-foreground">Copy for:</span>
        {(["tiktok", "facebook", "instagram", "messenger"] as const).map((ch) => {
          let tagged = url;
          try {
            const u = new URL(url);
            u.searchParams.set("ref", ch);
            tagged = u.toString();
          } catch {
            tagged = `${url}${url.includes("?") ? "&" : "?"}ref=${ch}`;
          }
          return (
            <button key={ch} type="button" className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1" onClick={() => void copy(`ref-${ch}`, tagged)}>
              {copied === `ref-${ch}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {ch === "tiktok" ? "TikTok" : ch === "facebook" ? "Facebook" : ch === "instagram" ? "Instagram" : "Messenger"}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {canNativeShare && (
          <button
            type="button"
            className={ghostBtn}
            onClick={() => void navigator.share({ title: link.title, text: caption, url }).catch(() => undefined)}
          >
            <Share2 className="h-4 w-4" /> Share…
          </button>
        )}
        {targets.map((t) => (
          <a
            key={t.label}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className={`${ghostBtn} ${t.mobileOnly ? "sm:hidden" : ""}`}
          >
            {t.label}
          </a>
        ))}
        <button type="button" className={ghostBtn} onClick={onShowQr}>
          <QrCode className="h-4 w-4" /> QR code
        </button>
        <SharePostImageButton code={link.code} items={link.items} url={url} className={ghostBtn} />
      </div>
      <p className="text-xs text-muted-foreground">
        Post image: a square photo with the price, link and QR — ready for your Facebook or IG post.
      </p>

      <div>
        <p className="text-xs text-muted-foreground">Ready-made caption</p>
        <div className="mt-1 flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="min-w-0 flex-1 whitespace-pre-line break-all text-sm">{caption}</p>
          <button type="button" className={ghostBtn} onClick={() => void copy("caption", caption)}>
            {copied === "caption" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "caption" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QrModal({ link, url, onClose }: { link: CheckoutLink; url: string; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [url]);

  async function downloadPng() {
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 1024, errorCorrectionLevel: "M" });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `checkout-${link.code}.png`;
    a.click();
  }

  return (
    <Modal title="QR code" onClose={onClose}>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="rounded-2xl bg-white p-4">
          {svg ? (
            <div className="h-60 w-60" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="h-60 w-60" />
          )}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Print it for your stall, or show it on screen during a live. Buyers scan and order.
        </p>
        <button
          type="button"
          onClick={() => void downloadPng()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Download className="h-4 w-4" /> Download PNG
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl border border-white/10 bg-card p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-base font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
