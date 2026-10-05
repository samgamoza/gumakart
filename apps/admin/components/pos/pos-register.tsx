"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  History,
  Loader2,
  Lock,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  Send,
  ShoppingCart,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import {
  checkTenders,
  computeSaleTotals,
  discountRateFor,
  type PosDiscountType,
  type PosTenderMethod,
  type SaleTotals,
  type VatConfig,
} from "@gumakart/db/pos-tax";
import { productImageSrc } from "@/lib/product-image";
import {
  blockRemaining,
  cacheProducts,
  cacheRegister,
  cachedProducts,
  cachedState,
  clearBlock,
  deviceBlock,
  deviceId,
  enqueue,
  ensureBlock,
  lastShop,
  outbox,
  OUTBOX_WARN_AT,
  storageWorks,
  syncOutbox,
  takeInvoiceNumber,
} from "@/lib/pos-offline";

// ─── Types (API shapes) ──────────────────────────────────────────────────────

interface Variant {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  barcode: string | null;
  stockQty: number;
  imageUrl: string | null;
}

interface Product {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  stockQty: number | null;
  trackInventory: boolean;
  imageUrl: string | null;
  /** Phase 9: sizes/colours. More than one = the cashier picks. */
  variants?: Variant[];
  hasOptions?: boolean;
}

/** What goes on a cart line: a simple product or one variant of it. `id` is the line key. */
interface Sellable {
  id: string;
  productId: string;
  variantId: string | null;
  title: string;
  price: number;
  sku: string | null;
  stockQty: number | null;
  trackInventory: boolean;
  imageUrl: string | null;
}

const needsPick = (p: Product) => Boolean(p.hasOptions && (p.variants?.length ?? 0) > 1);

function sellableOf(p: Product, v?: Variant | null): Sellable {
  const variant = v ?? (p.hasOptions ? p.variants?.[0] : undefined) ?? null;
  return {
    id: variant && p.hasOptions ? variant.id : p.id,
    productId: p.id,
    variantId: variant && p.hasOptions ? variant.id : null,
    title: variant && p.hasOptions ? `${p.title} (${variant.title})` : p.title,
    price: variant && p.hasOptions ? variant.price : p.price,
    sku: variant?.sku ?? p.sku,
    stockQty: p.trackInventory ? (variant && p.hasOptions ? variant.stockQty : p.stockQty) : null,
    trackInventory: p.trackInventory,
    imageUrl: variant?.imageUrl ?? p.imageUrl,
  };
}

type Tenders = Record<PosTenderMethod, number>;

interface Shift {
  id: string;
  openingCash: number;
  openedAt: string;
  openedBy: string | null;
}

interface Summary {
  sales: number;
  salesTotal: number;
  discounts: number;
  seniorPwdSales: number;
  vat: number;
  byMethod: Tenders;
  expected: Tenders;
}

interface SaleRow {
  orderId: string;
  orderNumber: string;
  total: number;
  createdAt: string;
  cashierName: string | null;
  itemCount: number;
  method: string | null;
}

interface State {
  ok: boolean;
  error?: string;
  code?: string;
  actor: { name: string; role: "owner" | "manager" | "cashier"; isStaff: boolean; staffId?: string | null };
  shop: { name: string; slug: string };
  shift: Shift | null;
  summary: Summary | null;
  sales: SaleRow[];
  vat: VatConfig;
  wallets: { gcash: boolean; maya: boolean };
  deviceRegistered: boolean;
  /** Phase 12b: BIR receipt header when numbering is on (offline receipts need it). */
  bir?: (NonNullable<Receipt["bir"]> & { invoicePrefix?: string }) | null;
  offlineIssues?: number;
}

interface Receipt {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  shopName: string;
  cashierName: string;
  items: Array<{ title: string; quantity: number; unitPrice: number; lineTotal: number }>;
  totals: SaleTotals;
  discountType: PosDiscountType;
  discountHolder: { name: string | null; idNumberLast4: string | null } | null;
  tenders: Array<{ method: PosTenderMethod; amount: number; reference: string | null }>;
  change: number;
  customer: { name: string | null; phone: string | null };
  duplicate?: boolean;
  /** Phase 11 */
  invoiceNumber?: string | null;
  bir?: {
    registeredName?: string;
    tradeName?: string;
    tin?: string;
    branchCode?: string;
    address?: string;
    min?: string;
    serialNo?: string;
    ptuNo?: string;
    ptuDate?: string;
    accreditationNo?: string;
    vatRegistered: boolean;
  } | null;
  voided?: boolean;
  refunded?: number;
  /** Phase 12b: rung offline (synced or not). */
  offline?: boolean;
  /** Still only on this device. */
  pendingSync?: boolean;
  syncIssues?: number;
}

interface ReturnLine {
  orderItemId: string;
  title: string;
  quantity: number;
  returnedQty: number;
  unitPrice: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const peso = (n: number) =>
  `${n < 0 ? "-" : ""}₱${Math.abs(Math.round(n * 100) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD_LABEL: Record<PosTenderMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", card: "Card" };
const METHOD_ICON: Record<PosTenderMethod, typeof Banknote> = { cash: Banknote, gcash: Smartphone, maya: Smartphone, card: CreditCard };

function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    return (await res.json()) as T & { ok: boolean; error?: string; code?: string };
  } catch {
    return { ok: false, error: "No connection. Check the internet and try again.", code: "NETWORK" } as T & { ok: boolean; error?: string; code?: string };
  }
}

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40";
const btnPrimary = `${btn} bg-violet-600 text-white hover:bg-violet-500`;
const btnGhost = `${btn} border border-white/15 text-slate-100 hover:bg-white/[0.06]`;

function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[94vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0f1528] p-5 text-slate-100 sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function MoneyInput({ value, onChange, autoFocus, label }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">₱</span>
        <input
          className="guma-field pl-7 text-right text-base font-semibold"
          inputMode="decimal"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label={label}
        />
      </div>
    </label>
  );
}

// ─── Receipt (also what gets printed) ────────────────────────────────────────

function ReceiptView({ r, vat }: { r: Receipt; vat: VatConfig }) {
  const when = new Date(r.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div id="pos-receipt" className="relative mx-auto w-full max-w-[320px] rounded-xl bg-white p-4 font-mono text-[12px] leading-5 text-black">
      {r.voided && (
        <p className="pointer-events-none absolute inset-x-0 top-1/3 rotate-[-18deg] text-center text-4xl font-black tracking-widest text-red-600/40">VOIDED</p>
      )}
      {r.bir ? (
        <>
          <p className="text-center text-sm font-bold">{r.bir.tradeName || r.shopName}</p>
          <p className="text-center">{r.bir.registeredName}</p>
          <p className="text-center text-[11px]">{r.bir.address}</p>
          <p className="text-center text-[11px]">
            {r.bir.vatRegistered ? "VAT REG TIN" : "NON-VAT REG TIN"} {r.bir.tin}
            {r.bir.branchCode ? `-${r.bir.branchCode}` : ""}
          </p>
          <p className="text-center text-[11px]">MIN {r.bir.min} · SN {r.bir.serialNo}</p>
          <p className="mt-1 text-center font-bold">SALES INVOICE</p>
          <p className="text-center">No. {r.invoiceNumber}</p>
        </>
      ) : (
        <p className="text-center text-sm font-bold">{r.shopName}</p>
      )}
      {r.pendingSync ? <p className="text-center">Sale # (sent when online)</p> : <p className="text-center">Sale #{r.orderNumber}</p>}
      <p className="text-center">{when}</p>
      <p className="text-center">Cashier: {r.cashierName}</p>
      <hr className="my-2 border-dashed border-black/40" />
      {r.items.map((i, idx) => (
        <div key={idx}>
          <p className="truncate">{i.title}</p>
          <p className="flex justify-between">
            <span>
              {i.quantity} × {peso(i.unitPrice)}
            </span>
            <span>{peso(i.lineTotal)}</span>
          </p>
        </div>
      ))}
      <hr className="my-2 border-dashed border-black/40" />
      <p className="flex justify-between">
        <span>Subtotal</span>
        <span>{peso(r.totals.subtotal)}</span>
      </p>
      {r.discountType !== "none" && (
        <>
          <p className="flex justify-between">
            <span>{r.discountType === "pwd" ? "PWD" : "Senior"} 20%</span>
            <span>-{peso(r.totals.discountAmount)}</span>
          </p>
          {vat.registered && <p className="text-[11px]">VAT-exempt sale (VAT removed before discount)</p>}
          {r.discountHolder?.name && <p className="text-[11px]">Name: {r.discountHolder.name}</p>}
          {r.discountHolder?.idNumberLast4 && <p className="text-[11px]">ID: ••••{r.discountHolder.idNumberLast4}</p>}
        </>
      )}
      <p className="mt-1 flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{peso(r.totals.total)}</span>
      </p>
      {r.tenders.map((t, idx) => (
        <p key={idx} className="flex justify-between">
          <span>
            {METHOD_LABEL[t.method]}
            {t.reference ? ` (${t.reference})` : ""}
          </span>
          <span>{peso(t.amount)}</span>
        </p>
      ))}
      {r.change > 0 && (
        <p className="flex justify-between font-bold">
          <span>Change</span>
          <span>{peso(r.change)}</span>
        </p>
      )}
      {vat.registered && !r.totals.vatExempt && (
        <>
          <hr className="my-2 border-dashed border-black/40" />
          <p className="flex justify-between">
            <span>VATable sales</span>
            <span>{peso(r.totals.netOfVat)}</span>
          </p>
          <p className="flex justify-between">
            <span>VAT {Math.round(r.totals.vatRate * 100)}%</span>
            <span>{peso(r.totals.vatAmount)}</span>
          </p>
        </>
      )}
      {vat.registered && r.totals.vatExempt && (
        <p className="flex justify-between">
          <span>VAT-exempt sales</span>
          <span>{peso(r.totals.vatExemptSales)}</span>
        </p>
      )}
      <hr className="my-2 border-dashed border-black/40" />
      {(r.refunded ?? 0) > 0 && !r.voided && <p className="text-center text-[11px]">Refunded: {peso(r.refunded ?? 0)}</p>}
      {r.offline && <p className="text-center text-[10px]">Rung offline{r.pendingSync ? " · saved on this register" : ""}</p>}
      <p className="text-center">Salamat po!</p>
      {r.bir ? (
        <>
          <p className="text-center text-[10px]">PTU No. {r.bir.ptuNo}{r.bir.ptuDate ? ` · ${r.bir.ptuDate}` : ""}</p>
          {r.bir.accreditationNo && <p className="text-center text-[10px]">Accreditation No. {r.bir.accreditationNo}</p>}
          {!r.bir.vatRegistered && <p className="text-center text-[10px]">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p>}
        </>
      ) : (
        <p className="text-center text-[10px]">This is not an official receipt.</p>
      )}
    </div>
  );
}

// ─── Offline helpers ─────────────────────────────────────────────────────────

interface SaleItemBody {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice?: number;
}

/** Take sold units off the device's product list (offline sales; the server does it on sync). */
function takeStockLocally(products: Product[], items: SaleItemBody[]): Product[] {
  if (!items.length) return products;
  return products.map((p) => {
    const mine = items.filter((i) => i.productId === p.id);
    if (!mine.length || !p.trackInventory) return p;
    const sold = mine.reduce((n, i) => n + i.quantity, 0);
    const variants = p.variants?.map((v) => {
      const q = mine.filter((i) => i.variantId === v.id).reduce((n, i) => n + i.quantity, 0);
      return q ? { ...v, stockQty: Math.max(v.stockQty - q, 0) } : v;
    });
    const simpleSold = p.hasOptions ? 0 : sold;
    return {
      ...p,
      variants,
      stockQty: p.stockQty === null ? null : p.hasOptions ? (variants ?? []).reduce((n, v) => n + v.stockQty, 0) : Math.max(p.stockQty - simpleSold, 0),
    };
  });
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

/** Header pill: online / offline / sales waiting to be sent. */
function SyncPill({ online, pending, syncing, onSync }: { online: boolean; pending: number; syncing: boolean; onSync: () => void }) {
  if (online && pending === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300" data-testid="pos-net">
        <Wifi className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Online</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing || !online}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-violet-500/20 text-violet-200" : "bg-amber-500/15 text-amber-200"}`}
      data-testid="pos-net"
      title={online ? "Send waiting sales now" : "No internet — sales are saved on this device"}
    >
      {online ? <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> : <WifiOff className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{online ? "Sending" : "Offline"}</span>
      {pending > 0 && <span className="rounded-full bg-black/30 px-1.5" data-testid="pos-pending">{pending}</span>}
    </button>
  );
}

/** Managers: offline sales the server flagged (stock short, price changed, …). */
function OfflineIssuesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [issues, setIssues] = useState<Array<{ id: string; kind: string; message: string; createdAt: string; detail: Record<string, unknown> | null }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadIssues = useCallback(async () => {
    const r = await api<{ issues: Array<{ id: string; kind: string; message: string; createdAt: string; detail: Record<string, unknown> | null }> }>("/api/pos/offline/issues");
    if (r.ok) setIssues(r.issues);
    else setError(r.error ?? "Could not load.");
  }, []);
  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);
  const LABEL: Record<string, string> = {
    stock_short: "Stock ran short",
    price_changed: "Price changed",
    unavailable: "Item no longer for sale",
    invoice_reassigned: "Invoice no. changed",
    closed_shift: "After shift close",
    after_z: "After Z reading",
    rejected: "Not saved as a sale",
  };
  return (
    <Modal title="Offline sales to check" onClose={onClose}>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!issues ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
      ) : issues.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">All checked.</p>
      ) : (
        <ul className="space-y-2" data-testid="pos-issues">
          {issues.map((i) => (
            <li key={i.id} className="rounded-xl border border-white/10 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">{LABEL[i.kind] ?? i.kind}</p>
              <p className="mt-1">{i.message}</p>
              {i.kind === "rejected" && i.detail && (
                <details className="mt-1 text-xs text-slate-400">
                  <summary className="cursor-pointer">What was sold</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify({ items: i.detail.items, tenders: i.detail.tenders, customer: i.detail.customer }, null, 1)}</pre>
                </details>
              )}
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{new Date(i.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-3 py-1 font-semibold text-slate-200"
                  onClick={async () => {
                    const r = await api("/api/pos/offline/issues", { method: "POST", body: JSON.stringify({ id: i.id }) });
                    if (r.ok) {
                      setIssues((list) => (list ?? []).filter((x) => x.id !== i.id));
                      onChanged();
                    }
                  }}
                >
                  Checked
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function PosRegister() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Array<{ product: Sellable; qty: number }>>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [discountType, setDiscountType] = useState<PosDiscountType>("none");
  const [holder, setHolder] = useState({ name: "", idNumber: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "pay" | "receipt" | "close" | "sales" | "cart" | "issues">(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptFromHistory, setReceiptFromHistory] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Phase 12b: offline mode.
  const [online, setOnline] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [canStore, setCanStore] = useState(true);
  const [blockLeft, setBlockLeft] = useState<number | null>(null);
  const shopRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    const data = await api<State>("/api/pos/state");
    if (!data.ok) {
      if (data.code === "POS_LOCKED") {
        router.replace("/pos/login");
        return false;
      }
      if (data.code === "NETWORK") {
        // No internet: open the register from what this device saved last time.
        const shop = shopRef.current ?? lastShop();
        const cached = shop ? cachedState<State>(shop) : null;
        if (cached) {
          shopRef.current = shop;
          setOnline(false);
          setCachedAt(cached.savedAt);
          setState((prev) => prev ?? cached.state);
          setPending(outbox(shop!).length);
          setBlockLeft(cached.state.bir ? blockRemaining(deviceBlock(shop!)) : null);
          setLoadError(null);
          return false;
        }
      }
      setLoadError(data.error ?? "Could not load the register.");
      return false;
    }
    const shop = data.shop.slug;
    shopRef.current = shop;
    setLoadError(null);
    setOnline(true);
    setCachedAt(null);
    setState(data);
    cacheRegister(shop, data);
    setPending(outbox(shop).length);
    if (data.bir) {
      void ensureBlock(shop, data.bir.invoicePrefix ?? "").then((b) => setBlockLeft(blockRemaining(b)));
    } else {
      if (outbox(shop).length === 0) clearBlock(shop);
      setBlockLeft(null);
    }
    return true;
  }, [router]);

  const loadProducts = useCallback(async () => {
    const data = await api<{ products: Product[] }>("/api/pos/products");
    const shop = shopRef.current;
    if (data.ok) {
      // Sales still waiting to sync already took stock on this device.
      const waiting = shop ? outbox<Receipt>(shop) : [];
      const list = waiting.reduce((ps, sale) => takeStockLocally(ps, (sale.body.items ?? []) as SaleItemBody[]), data.products);
      setProducts(list);
      if (shop) cacheProducts(shop, list);
    } else if (data.code === "NETWORK" && shop) {
      const cached = cachedProducts<Product>(shop);
      if (cached) setProducts((prev) => (prev.length ? prev : cached));
    }
  }, []);

  const runSync = useCallback(async () => {
    const shop = shopRef.current;
    if (!shop || outbox(shop).length === 0) return;
    setSyncing(true);
    const r = await syncOutbox(shop);
    setSyncing(false);
    setPending(r.remaining);
    if (r.stop === "offline") setOnline(false);
    if (r.stop === "locked") setSyncMsg({ text: "Unlock the register with a PIN to send the waiting sales.", tone: "warn" });
    else if (r.stop === "error") setSyncMsg({ text: "A waiting sale couldn't be sent yet. It will retry; tell the owner if this stays.", tone: "warn" });
    if (r.synced || r.parked) {
      const parts = [`${r.synced} offline sale${r.synced === 1 ? "" : "s"} sent.`];
      if (r.flagged) parts.push(`${r.flagged} need${r.flagged === 1 ? "s" : ""} a look (stock or price changed).`);
      if (r.parked) parts.push(`${r.parked} couldn't be saved as a sale and ${r.parked === 1 ? "was" : "were"} kept for the owner.`);
      setSyncMsg({ text: parts.join(" "), tone: r.flagged || r.parked ? "warn" : "ok" });
      setNotice(null);
      await load();
      await loadProducts();
    }
  }, [load, loadProducts]);

  useEffect(() => {
    setCanStore(storageWorks());
    void (async () => {
      const ok = await load();
      await loadProducts();
      if (ok) void runSync();
    })();
    // Keep the register usable when the internet drops (production builds only — the
    // dev server's files change on every edit).
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/pos-sw.js", { scope: "/pos" }).catch(() => undefined);
    }
  }, [load, loadProducts, runSync]);

  // Back online → send waiting sales. Also check every 20s (navigator.onLine can lie).
  useEffect(() => {
    const goOnline = () => {
      void load().then((ok) => {
        if (ok) {
          void loadProducts();
          void runSync();
        }
      });
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = window.setInterval(() => {
      if (!online || pending > 0) goOnline();
    }, 20_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(timer);
    };
  }, [online, pending, load, loadProducts, runSync]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase() === q ||
        (p.variants ?? []).some((v) => (v.sku ?? "").toLowerCase() === q || (v.barcode ?? "").toLowerCase() === q)
    );
  }, [products, query]);

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const totals = useMemo(
    () =>
      computeSaleTotals({
        subtotal,
        discountRate: discountRateFor(discountType),
        discountType,
        config: state?.vat,
      }),
    [subtotal, discountType, state?.vat]
  );
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  function inCart(id: string) {
    return cart.find((l) => l.product.id === id)?.qty ?? 0;
  }

  /** All lines of a product (any variant) — for the tile's "left" count. */
  function inCartProduct(productId: string) {
    return cart.filter((l) => l.product.productId === productId).reduce((n, l) => n + l.qty, 0);
  }

  function tap(p: Product) {
    if (needsPick(p)) {
      setPicking(p);
      return;
    }
    add(sellableOf(p));
  }

  function add(p: Sellable) {
    if (p.trackInventory && p.stockQty !== null && inCart(p.id) >= p.stockQty) {
      setNotice(`Only ${p.stockQty} "${p.title}" in stock.`);
      return;
    }
    setNotice(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i === -1) return [...c, { product: p, qty: 1 }];
      const next = [...c];
      next[i] = { ...next[i]!, qty: next[i]!.qty + 1 };
      return next;
    });
  }

  function setQty(id: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty } : l))));
  }

  function onScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    // A variant's own SKU/barcode adds that exact size/colour.
    for (const p of products) {
      const v = (p.variants ?? []).find((x) => (x.barcode ?? "").toLowerCase() === q || (x.sku ?? "").toLowerCase() === q);
      if (v && p.hasOptions) {
        add(sellableOf(p, v));
        setQuery("");
        return;
      }
    }
    const exact = products.find((p) => (p.sku ?? "").toLowerCase() === q) ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (exact) {
      tap(exact);
      setQuery("");
    } else {
      setNotice(`No product with code "${query.trim()}".`);
    }
  }

  function resetSale() {
    setCart([]);
    setDiscountType("none");
    setHolder({ name: "", idNumber: "" });
    setNotice(null);
    setReceipt(null);
    setModal(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  async function lock() {
    await api("/api/pos/login", { method: "DELETE" });
    router.replace("/pos/login");
  }

  /**
   * No internet: save the sale on this device and print it. The cash is in the drawer and
   * the goods are with the buyer; the server records it when the internet is back.
   */
  function saveOffline(
    current: State,
    body: Record<string, unknown>,
    tenders: Array<{ method: PosTenderMethod; amount: number; reference?: string }>,
    customer: { name?: string; phone?: string } | undefined,
    key: string
  ): string | null {
    const shop = shopRef.current;
    if (!shop || !current.shift) return "Open the register while online first.";
    if (!canStore) return "This browser can't keep sales offline (private mode or blocked storage). Connect to the internet to continue.";
    const check = checkTenders(totals.total, tenders);
    if (!check.ok) return check.error;
    if (discountType !== "none" && !holder.idNumber.trim()) return "Enter the Senior/PWD ID number for the discount.";
    let invoiceNumber: string | null = null;
    if (current.bir) {
      invoiceNumber = takeInvoiceNumber(shop);
      if (!invoiceNumber) return "No offline invoice numbers left on this register. Connect to the internet to keep selling.";
      setBlockLeft(blockRemaining(deviceBlock(shop)));
    }
    const now = new Date();
    const items: SaleItemBody[] = cart.map((l) => ({ productId: l.product.productId, variantId: l.product.variantId, quantity: l.qty, unitPrice: l.product.price }));
    const receiptLocal: Receipt = {
      orderId: `offline-${key}`,
      orderNumber: "",
      createdAt: now.toISOString(),
      shopName: current.shop.name,
      cashierName: current.actor.name,
      items: cart.map((l) => ({ title: l.product.title, quantity: l.qty, unitPrice: l.product.price, lineTotal: Math.round(l.product.price * l.qty * 100) / 100 })),
      totals,
      discountType,
      discountHolder: discountType !== "none" ? { name: holder.name.trim() || null, idNumberLast4: holder.idNumber.replace(/\s/g, "").slice(-4) || null } : null,
      tenders: tenders.map((t) => ({ method: t.method, amount: t.amount, reference: t.reference ?? null })),
      change: check.change,
      customer: { name: customer?.name ?? null, phone: customer?.phone ?? null },
      invoiceNumber,
      bir: current.bir ?? null,
      voided: false,
      refunded: 0,
      offline: true,
      pendingSync: true,
    };
    const saved = enqueue(shop, {
      key,
      body: {
        ...body,
        items,
        offline: {
          rungAt: now.toISOString(),
          shiftId: current.shift.id,
          deviceId: deviceId(),
          invoiceNumber,
          totals,
          staffId: current.actor.staffId ?? null,
          cashierName: current.actor.name,
        },
      },
      receipt: receiptLocal,
      queuedAt: now.toISOString(),
      attempts: 0,
    });
    if (!saved) return "This device couldn't save the sale (storage full). Connect to the internet before completing it.";
    setProducts((ps) => {
      const next = takeStockLocally(ps, items);
      cacheProducts(shop, next);
      return next;
    });
    setPending(outbox(shop).length);
    setReceipt(receiptLocal);
    setModal("receipt");
    return null;
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0F1D] p-6 text-slate-100">
        <div className="max-w-sm text-center">
          <p>{loadError}</p>
          <button type="button" className={`${btnGhost} mt-4`} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0F1D] text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const isOwner = state.actor.role === "owner";

  return (
    <div className="min-h-screen bg-[#0A0F1D] text-slate-100">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #pos-receipt, #pos-receipt * { visibility: visible !important; }
          #pos-receipt { position: absolute; left: 0; top: 0; width: 72mm; max-width: 72mm; border-radius: 0; padding: 0; }
          @page { margin: 4mm; }
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0A0F1D]/95 px-3 py-2 backdrop-blur sm:px-4">
        {isOwner && (
          <Link href="/" className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Back to dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{state.shop.name} · POS</p>
          <p className="truncate text-xs text-slate-400">
            {state.actor.name}
            {state.actor.role !== "cashier" ? ` (${state.actor.role})` : ""}
            {state.shift ? ` · shift since ${new Date(state.shift.openedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <SyncPill online={online} pending={pending} syncing={syncing} onSync={() => void runSync()} />
        {state.shift && (
          <>
            <button type="button" className={`${btnGhost} px-3`} onClick={() => setModal("sales")}>
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Sales</span>
              <span className="rounded-full bg-white/10 px-1.5 text-xs">{state.summary?.sales ?? 0}</span>
            </button>
            <button
              type="button"
              className={`${btnGhost} px-3`}
              onClick={() => {
                if (pending > 0) return setNotice(`Send the ${pending} waiting sale${pending === 1 ? "" : "s"} first — closing the shift needs them counted.`);
                if (!online) return setNotice("Closing a shift needs internet.");
                setModal("close");
              }}
            >
              Close shift
            </button>
          </>
        )}
        {(state.actor.isStaff || state.deviceRegistered) && (
          <button type="button" className={`${btnGhost} px-3`} onClick={() => void lock()} aria-label="Lock register" disabled={!online} title={online ? undefined : "Locking needs internet (unlocking checks the PIN)"}>
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Lock</span>
          </button>
        )}
      </header>

      {!online && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm sm:mx-4" data-testid="pos-offline-banner">
          <p className="flex items-center gap-2 font-semibold text-amber-200">
            <WifiOff className="h-4 w-4" /> No internet — keep selling
          </p>
          <p className="mt-1 text-slate-300">
            Sales are saved on this device and sent automatically when you&apos;re back online.
            {cachedAt ? ` Prices and stock are as of ${timeAgo(cachedAt)}.` : ""}
            {state.bir ? ` ${blockLeft ?? 0} offline invoice number${blockLeft === 1 ? "" : "s"} left.` : ""}
          </p>
          {!canStore && <p className="mt-1 font-semibold text-red-300">This browser can&apos;t save sales offline (private mode or blocked storage).</p>}
          {pending >= OUTBOX_WARN_AT && <p className="mt-1 font-semibold text-amber-200">{pending} sales waiting — connect soon.</p>}
        </div>
      )}
      {syncMsg && (
        <div className={`mx-3 mt-3 flex items-start gap-2 rounded-xl p-3 text-sm sm:mx-4 ${syncMsg.tone === "ok" ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`} data-testid="pos-sync-msg">
          <p className="min-w-0 flex-1">{syncMsg.text}</p>
          <button type="button" onClick={() => setSyncMsg(null)} aria-label="Dismiss" className="text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {online && (state.actor.role === "owner" || state.actor.role === "manager") && (state.offlineIssues ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => setModal("issues")}
          className="mx-3 mt-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-left text-sm text-amber-100 sm:mx-4 sm:w-[calc(100%-2rem)]"
          data-testid="pos-issues-banner"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {state.offlineIssues} offline sale{state.offlineIssues === 1 ? "" : "s"} need{state.offlineIssues === 1 ? "s" : ""} a look (stock, price or invoice changed).
          </span>
          <span className="font-semibold underline">Check</span>
        </button>
      )}

      {isOwner && !state.deviceRegistered && online && (
        <div className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-sm sm:mx-4">
          <p className="min-w-0 flex-1">
            Let your staff use this phone or tablet with their own PIN — they won&apos;t see the rest of your dashboard (when a cashier unlocks it,
            you&apos;re signed out on this device).{" "}
            <Link href="/settings/pos" className="font-semibold text-violet-300 underline">
              Add staff
            </Link>
          </p>
          <button
            type="button"
            className={btnPrimary}
            onClick={async () => {
              const r = await api("/api/pos/device", { method: "POST" });
              if (r.ok) void load();
            }}
          >
            Use this device for cashiers
          </button>
        </div>
      )}

      {!state.shift ? (
        <OpenShift onOpened={() => void load()} actorName={state.actor.name} />
      ) : (
        <div className="lg:grid lg:grid-cols-[1fr_400px]">
          {/* Products */}
          <section className="p-3 pb-28 sm:p-4 lg:pb-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
              <input
                ref={searchRef}
                className="guma-field pl-9 pr-10"
                placeholder="Search or scan a barcode"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onScan}
                aria-label="Search or scan"
              />
              <ScanBarcode className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
            </div>
            {notice && <p className="mt-2 text-sm text-amber-300">{notice}</p>}
            {products.length === 0 ? (
              <p className="mt-8 text-center text-sm text-slate-400">
                No active products yet.{" "}
                {isOwner && (
                  <Link className="text-violet-300 underline" href="/products">
                    Add products
                  </Link>
                )}
              </p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => {
                  const left = p.trackInventory && p.stockQty !== null ? p.stockQty - inCartProduct(p.id) : null;
                  const pick = needsPick(p);
                  const fromPrice = pick ? Math.min(...(p.variants ?? []).map((v) => v.price)) : p.price;
                  const out = left !== null && left <= 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => tap(p)}
                        disabled={out}
                        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left transition hover:border-violet-400/60 active:scale-[0.98] disabled:opacity-40"
                        data-testid="pos-product"
                      >
                        <div className="aspect-[4/3] w-full bg-white/5">
                          {p.imageUrl && online ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={productImageSrc(p.imageUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-2xl font-bold text-white/20">{p.title.slice(0, 1)}</div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-2">
                          <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
                          <span className="mt-auto flex items-center justify-between pt-1">
                            <span className="font-bold text-violet-200">
                              {pick ? <span className="text-[11px] font-medium text-slate-400">from </span> : null}
                              {peso(fromPrice)}
                            </span>
                            {left !== null && <span className={`text-[11px] ${left <= 3 ? "text-amber-300" : "text-slate-500"}`}>{out ? "Out" : `${left} left`}</span>}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Cart — side panel on desktop */}
          <aside className="hidden border-l border-white/10 lg:block">
            <div className="sticky top-[57px] flex h-[calc(100vh-57px)] flex-col">
              <CartPanel
                cart={cart}
                setQty={setQty}
                totals={totals}
                vat={state.vat}
                discountType={discountType}
                setDiscountType={setDiscountType}
                holder={holder}
                setHolder={setHolder}
                onCharge={() => setModal("pay")}
                onClear={() => setCart([])}
              />
            </div>
          </aside>

          {/* Phone: sticky bar → cart sheet */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0A0F1D]/95 p-3 backdrop-blur lg:hidden">
            <div className="flex gap-2">
              <button type="button" className={`${btnGhost} flex-1 justify-between`} onClick={() => setModal("cart")} disabled={itemCount === 0}>
                <span className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" /> {itemCount} item{itemCount === 1 ? "" : "s"}
                </span>
                <span>{peso(totals.total)}</span>
              </button>
              <button type="button" className={btnPrimary} disabled={itemCount === 0} onClick={() => setModal("pay")} data-testid="pos-charge-mobile">
                Charge
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cart" && (
        <Modal title="Cart" onClose={() => setModal(null)}>
          <CartPanel
            cart={cart}
            setQty={setQty}
            totals={totals}
            vat={state.vat}
            discountType={discountType}
            setDiscountType={setDiscountType}
            holder={holder}
            setHolder={setHolder}
            onCharge={() => setModal("pay")}
            onClear={() => {
              setCart([]);
              setModal(null);
            }}
            embedded
          />
        </Modal>
      )}

      {picking && (
        <Modal title={`Pick for ${picking.title}`} onClose={() => setPicking(null)}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="pos-variant-picker">
            {(picking.variants ?? []).map((v) => {
              const left = picking.trackInventory ? v.stockQty - inCart(v.id) : null;
              const out = left !== null && left <= 0;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => {
                      add(sellableOf(picking, v));
                      setPicking(null);
                    }}
                    className="flex w-full flex-col rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:border-violet-400/60 disabled:opacity-40"
                  >
                    <span className="text-sm font-semibold">{v.title}</span>
                    <span className="mt-1 flex items-center justify-between text-xs">
                      <span className="font-bold text-violet-200">{peso(v.price)}</span>
                      {left !== null && <span className={left <= 3 ? "text-amber-300" : "text-slate-500"}>{out ? "Out" : `${left} left`}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}

      {modal === "pay" && state.shift && (
        <PayModal
          total={totals.total}
          wallets={state.wallets}
          onClose={() => setModal(null)}
          offline={!online}
          submit={async (tenders, customer, key) => {
            const body = {
              idempotencyKey: key,
              items: cart.map((l) => ({ productId: l.product.productId, variantId: l.product.variantId, quantity: l.qty })),
              discountType,
              discountHolder: discountType !== "none" ? holder : undefined,
              tenders,
              customer,
            };
            // Waiting offline sales go first so the server sees them in order.
            const shop = shopRef.current;
            if (online && shop && outbox(shop).length > 0) await runSync();
            if (online && (!shop || outbox(shop).length === 0)) {
              const r = await api<{ receipt: Receipt }>("/api/pos/sales", { method: "POST", body: JSON.stringify(body) });
              if (r.ok) {
                setReceipt(r.receipt);
                setModal("receipt");
                void load();
                void loadProducts();
                return null;
              }
              if (r.code !== "NETWORK") return r.error ?? "Could not save the sale.";
              setOnline(false);
            }
            return saveOffline(state, body, tenders, customer, key);
          }}
        />
      )}

      {modal === "receipt" && receipt && (
        <Modal title={receipt.pendingSync ? "Sale saved on this device" : receipt.duplicate ? "Sale already saved" : "Sale complete"} wide>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <ReceiptView r={receipt} vat={state.vat} />
            <div className="space-y-4">
              <ReceiptActions receipt={receipt} onNewSale={resetSale} />
              {receiptFromHistory && online && !receipt.pendingSync && (state.actor.role === "owner" || state.actor.role === "manager") && !receipt.voided && (
                <SaleManage
                  receipt={receipt}
                  onDone={async (msg) => {
                    setNotice(msg);
                    setReceiptFromHistory(false);
                    setModal(null);
                    await load();
                    await loadProducts();
                  }}
                />
              )}
            </div>
          </div>
        </Modal>
      )}

      {modal === "sales" && state.shift && (
        <SalesModal
          queued={shopRef.current ? outbox<Receipt>(shopRef.current).map((q) => q.receipt) : []}
          onOpenQueued={(r) => {
            setReceipt(r);
            setReceiptFromHistory(true);
            setModal("receipt");
          }}
          sales={state.sales}
          summary={state.summary}
          onClose={() => setModal(null)}
          onOpen={async (id) => {
            const r = await api<{ receipt: Receipt }>(`/api/pos/sales/${id}`);
            if (r.ok) {
              setReceipt({ ...r.receipt, duplicate: false });
              setReceiptFromHistory(true);
              setModal("receipt");
            }
          }}
        />
      )}

      {modal === "issues" && (
        <OfflineIssuesModal
          onClose={() => setModal(null)}
          onChanged={() => setState((st) => (st ? { ...st, offlineIssues: Math.max((st.offlineIssues ?? 1) - 1, 0) } : st))}
        />
      )}

      {modal === "close" && state.shift && state.summary && (
        <CloseShiftModal
          shift={state.shift}
          summary={state.summary}
          onClose={() => setModal(null)}
          onClosed={() => {
            setModal(null);
            resetSale();
            void load();
          }}
        />
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function OpenShift({ onOpened, actorName }: { onOpened: () => void; actorName: string }) {
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto mt-10 max-w-sm px-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h1 className="text-xl font-bold">Open the shift</h1>
        <p className="mt-1 text-sm text-slate-400">Hi {actorName}! Count the cash in the drawer before your first sale.</p>
        <div className="mt-4">
          <MoneyInput label="Cash in drawer (panukli)" value={cash} onChange={setCash} autoFocus />
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="button"
          className={`${btnPrimary} mt-4 w-full`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await api("/api/pos/shift", { method: "POST", body: JSON.stringify({ openingCash: Number(cash || 0) }) });
            setBusy(false);
            if (!r.ok && r.code !== "SHIFT_OPEN") return setError(r.error ?? "Could not open the shift.");
            onOpened();
          }}
          data-testid="pos-open-shift"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Open shift
        </button>
      </div>
    </div>
  );
}

function CartPanel(props: {
  cart: Array<{ product: Sellable; qty: number }>;
  setQty: (id: string, qty: number) => void;
  totals: SaleTotals;
  vat: VatConfig;
  discountType: PosDiscountType;
  setDiscountType: (t: PosDiscountType) => void;
  holder: { name: string; idNumber: string };
  setHolder: (h: { name: string; idNumber: string }) => void;
  onCharge: () => void;
  onClear: () => void;
  embedded?: boolean;
}) {
  const { cart, totals, vat, discountType } = props;
  const needsId = discountType !== "none" && !props.holder.idNumber.trim();
  return (
    <div className={`flex flex-col ${props.embedded ? "" : "h-full"}`}>
      <div className={`flex items-center justify-between ${props.embedded ? "" : "border-b border-white/10 px-4 py-3"}`}>
        <p className="font-semibold">Current sale</p>
        {cart.length > 0 && (
          <button type="button" className="text-xs text-slate-400 hover:text-red-300" onClick={props.onClear}>
            Clear
          </button>
        )}
      </div>
      <ul className={`${props.embedded ? "mt-2" : "flex-1 overflow-y-auto px-4"} divide-y divide-white/10`}>
        {cart.length === 0 && <li className="py-8 text-center text-sm text-slate-500">Tap a product or scan a barcode.</li>}
        {cart.map((l) => (
          <li key={l.product.id} className="flex items-center gap-2 py-2.5" data-testid="pos-cart-line">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.product.title}</p>
              <p className="text-xs text-slate-400">{peso(l.product.price)} each</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-lg border border-white/15 p-1.5" onClick={() => props.setQty(l.product.id, l.qty - 1)} aria-label="Less">
                {l.qty === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              </button>
              <span className="w-7 text-center text-sm font-semibold">{l.qty}</span>
              <button
                type="button"
                className="rounded-lg border border-white/15 p-1.5 disabled:opacity-30"
                onClick={() => props.setQty(l.product.id, l.qty + 1)}
                disabled={l.product.trackInventory && l.product.stockQty !== null && l.qty >= l.product.stockQty}
                aria-label="More"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="w-20 text-right text-sm font-semibold">{peso(l.product.price * l.qty)}</span>
          </li>
        ))}
      </ul>

      <div className={`${props.embedded ? "mt-3" : "border-t border-white/10 p-4"} space-y-3`}>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-400">Discount</p>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1 text-sm">
            {(["none", "senior", "pwd"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => props.setDiscountType(t)}
                className={`rounded-lg py-1.5 font-medium ${discountType === t ? "bg-violet-600 text-white" : "text-slate-300"}`}
                aria-pressed={discountType === t}
              >
                {t === "none" ? "None" : t === "senior" ? "Senior" : "PWD"}
              </button>
            ))}
          </div>
          {discountType !== "none" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input className="guma-field h-10" placeholder="Name on ID" value={props.holder.name} onChange={(e) => props.setHolder({ ...props.holder, name: e.target.value })} />
              <input className="guma-field h-10" placeholder="ID number" value={props.holder.idNumber} onChange={(e) => props.setHolder({ ...props.holder, idNumber: e.target.value })} />
            </div>
          )}
        </div>

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-300">
            <dt>Subtotal</dt>
            <dd>{peso(totals.subtotal)}</dd>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-300">
              <dt>{discountType === "pwd" ? "PWD" : "Senior"} 20%{vat.registered ? " (VAT-exempt)" : ""}</dt>
              <dd>-{peso(totals.discountAmount)}</dd>
            </div>
          )}
          {vat.registered && !totals.vatExempt && (
            <div className="flex justify-between text-xs text-slate-500">
              <dt>VAT {Math.round(totals.vatRate * 100)}% {vat.inclusive ? "included" : "added"}</dt>
              <dd>{peso(totals.vatAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between pt-1 text-xl font-bold">
            <dt>Total</dt>
            <dd data-testid="pos-total">{peso(totals.total)}</dd>
          </div>
        </dl>
        {needsId && <p className="text-xs text-amber-300">Enter the Senior/PWD ID number to apply the discount.</p>}
        <button type="button" className={`${btnPrimary} w-full py-3 text-base`} disabled={cart.length === 0 || needsId} onClick={props.onCharge} data-testid="pos-charge">
          Charge {peso(totals.total)}
        </button>
      </div>
    </div>
  );
}

function PayModal({
  total,
  wallets,
  onClose,
  submit,
  offline,
}: {
  total: number;
  wallets: { gcash: boolean; maya: boolean };
  offline?: boolean;
  onClose: () => void;
  submit: (
    tenders: Array<{ method: PosTenderMethod; amount: number; reference?: string }>,
    customer: { name?: string; phone?: string } | undefined,
    key: string
  ) => Promise<string | null>;
}) {
  // One key per sale attempt: a retry after a timeout can never charge twice.
  const [key] = useState(newKey);
  const [first, setFirst] = useState<PosTenderMethod>("cash");
  const [firstAmount, setFirstAmount] = useState(total.toFixed(2));
  const [firstRef, setFirstRef] = useState("");
  const [split, setSplit] = useState(false);
  const [second, setSecond] = useState<PosTenderMethod>("gcash");
  const [secondAmount, setSecondAmount] = useState("");
  const [secondRef, setSecondRef] = useState("");
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenders = [
    { method: first, amount: Number(firstAmount || 0), reference: firstRef || undefined },
    ...(split ? [{ method: second, amount: Number(secondAmount || 0), reference: secondRef || undefined }] : []),
  ];
  const check = checkTenders(total, tenders);
  const quick = Array.from(new Set([total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, 500, 1000].filter((n) => n >= total))).slice(0, 4);

  const methodButtons = (value: PosTenderMethod, set: (m: PosTenderMethod) => void, exclude?: PosTenderMethod) => (
    <div className="grid grid-cols-4 gap-1.5">
      {(["cash", "gcash", "maya", "card"] as const)
        .filter((m) => m !== exclude)
        .map((m) => {
          const Icon = METHOD_ICON[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => set(m)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold ${value === m ? "border-violet-500 bg-violet-600/25 text-white" : "border-white/10 text-slate-300"}`}
              aria-pressed={value === m}
            >
              <Icon className="h-4 w-4" />
              {METHOD_LABEL[m]}
            </button>
          );
        })}
    </div>
  );

  return (
    <Modal title={`Charge ${peso(total)}`} onClose={busy ? undefined : onClose}>
      <div className="space-y-4">
        {methodButtons(first, (m) => {
          setFirst(m);
          if (m !== "cash" && Number(firstAmount) > total) setFirstAmount(total.toFixed(2));
        })}
        {(first === "gcash" && !wallets.gcash) || (first === "maya" && !wallets.maya) ? (
          <p className="text-xs text-amber-300">Check your own {METHOD_LABEL[first]} app for the payment before completing.</p>
        ) : null}
        <MoneyInput label={first === "cash" ? "Cash received" : `${METHOD_LABEL[first]} amount`} value={firstAmount} onChange={setFirstAmount} />
        {first === "cash" && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((n) => (
              <button key={n} type="button" className="rounded-lg border border-white/15 px-3 py-1.5 text-sm" onClick={() => setFirstAmount(n.toFixed(2))}>
                {n === total ? "Exact" : peso(n)}
              </button>
            ))}
          </div>
        )}
        {first !== "cash" && (
          <input className="guma-field" placeholder={first === "card" ? "Terminal approval code (optional)" : "Reference no. (optional)"} value={firstRef} onChange={(e) => setFirstRef(e.target.value)} />
        )}

        {!split ? (
          <button
            type="button"
            className="text-sm font-medium text-violet-300"
            onClick={() => {
              setSplit(true);
              setSecond(first === "cash" ? "gcash" : "cash");
              const rest = Math.max(total - Number(firstAmount || 0), 0);
              setSecondAmount(rest > 0 ? rest.toFixed(2) : "");
            }}
          >
            + Split with another payment
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Second payment</p>
              <button type="button" className="text-xs text-slate-400" onClick={() => setSplit(false)}>
                Remove
              </button>
            </div>
            {methodButtons(second, setSecond, first)}
            <MoneyInput label="Amount" value={secondAmount} onChange={setSecondAmount} />
            {second !== "cash" && (
              <input className="guma-field" placeholder="Reference no. (optional)" value={secondRef} onChange={(e) => setSecondRef(e.target.value)} />
            )}
          </div>
        )}

        <details className="rounded-xl border border-white/10 p-3 text-sm">
          <summary className="cursor-pointer text-slate-300">Buyer&apos;s name / mobile (optional)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="guma-field h-10" placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <input className="guma-field h-10" placeholder="09XX XXX XXXX" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Saves the sale to their customer record.</p>
        </details>

        <div className="rounded-xl bg-white/5 p-3 text-center">
          {check.ok ? (
            <p className="text-lg font-bold" data-testid="pos-change">
              Change: <span className="text-emerald-300">{peso(check.change)}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-300">{check.error}</p>
          )}
        </div>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {offline && (
          <p className="flex items-center gap-2 text-xs text-amber-200">
            <WifiOff className="h-3.5 w-3.5" /> Offline: this sale is saved on the register and sent later. For GCash/Maya/card, check the payment on your phone or terminal.
          </p>
        )}
        <button
          type="button"
          className={`${btnPrimary} w-full py-3 text-base`}
          disabled={!check.ok || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const err = await submit(
              tenders,
              customer.name.trim() || customer.phone.trim() ? { name: customer.name.trim() || undefined, phone: customer.phone.trim() || undefined } : undefined,
              key
            );
            setBusy(false);
            if (err) setError(err);
          }}
          data-testid="pos-complete"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Complete sale
        </button>
      </div>
    </Modal>
  );
}

function ReceiptActions({ receipt, onNewSale }: { receipt: Receipt; onNewSale: () => void }) {
  const [phone, setPhone] = useState(receipt.customer.phone ?? "");
  const [sms, setSms] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });
  return (
    <div className="space-y-3">
      {receipt.change > 0 && (
        <div className="rounded-xl bg-emerald-500/15 p-3 text-center">
          <p className="text-xs text-emerald-200">Give change</p>
          <p className="text-2xl font-bold text-emerald-300">{peso(receipt.change)}</p>
        </div>
      )}
      <button type="button" className={`${btnGhost} w-full`} onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print receipt
      </button>
      {receipt.pendingSync ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200" data-testid="pos-offline-saved">
          Saved on this register. It&apos;s sent to Guma Kart automatically when the internet is back — texting the receipt works after that.
        </p>
      ) : (
      <div className="space-y-2">
        <input className="guma-field h-10" placeholder="09XX XXX XXXX" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Buyer mobile" />
        <button
          type="button"
          className={`${btnGhost} w-full`}
          disabled={sms.busy || !phone.trim() || sms.ok}
          onClick={async () => {
            setSms({ busy: true, msg: null, ok: false });
            const r = await api<{ status?: string }>(`/api/pos/sales/${receipt.orderId}/sms`, { method: "POST", body: JSON.stringify({ phone }) });
            setSms({ busy: false, ok: r.ok, msg: r.ok ? (r.status === "already_sent" ? "Already texted." : "Receipt texted.") : (r.error ?? "Could not send.") });
          }}
        >
          {sms.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Text receipt
        </button>
        {sms.msg && <p className={`text-xs ${sms.ok ? "text-emerald-300" : "text-amber-300"}`}>{sms.msg}</p>}
      </div>
      )}
      <button type="button" className={`${btnPrimary} w-full py-3`} onClick={onNewSale} autoFocus data-testid="pos-new-sale">
        New sale
      </button>
    </div>
  );
}

/** Phase 11: manager tools on a past sale — void (same shift) or return items with a refund from the drawer. */
function SaleManage({ receipt, onDone }: { receipt: Receipt; onDone: (msg: string) => void | Promise<void> }) {
  const [mode, setMode] = useState<null | "void" | "return">(null);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<ReturnLine[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<PosTenderMethod>("cash");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "return" || lines) return;
    void api<{ view: { lines: ReturnLine[] } }>(`/api/pos/sales/${receipt.orderId}/lines`).then((d) => {
      if (d.ok) setLines(d.view.lines);
      else setErr(d.error ?? "Could not load the items.");
    });
  }, [mode, lines, receipt.orderId]);

  const suggested = (lines ?? []).reduce((n, l) => n + l.unitPrice * (qty[l.orderItemId] ?? 0), 0);
  useEffect(() => setAmount(suggested ? suggested.toFixed(2) : ""), [suggested]);

  async function submitVoid() {
    setBusy(true);
    setErr(null);
    const r = await api<{ result: { summary: string } }>(`/api/pos/sales/${receipt.orderId}/void`, { method: "POST", body: JSON.stringify({ reason }) });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Could not void.");
    await onDone(r.result.summary);
  }

  async function submitReturn() {
    setBusy(true);
    setErr(null);
    const items = (lines ?? []).filter((l) => (qty[l.orderItemId] ?? 0) > 0).map((l) => ({ orderItemId: l.orderItemId, qty: qty[l.orderItemId]!, restock }));
    const refundAmount = Number(amount || 0);
    const r = await api<{ result: { summary: string } }>(`/api/pos/sales/${receipt.orderId}/return`, {
      method: "POST",
      body: JSON.stringify({ items, refundAmount, refundMethod: refundAmount > 0 ? method : "none", note: reason || null }),
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Could not save the return.");
    await onDone(r.result.summary);
  }

  if (!mode) {
    return (
      <div className="flex gap-2 border-t border-white/10 pt-3">
        <button type="button" className={`${btnGhost} flex-1`} onClick={() => setMode("return")} data-testid="pos-return">
          Return items
        </button>
        <button type="button" className={`${btnGhost} flex-1 text-red-300`} onClick={() => setMode("void")} data-testid="pos-void">
          Void sale
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
      {err && <p className="text-xs text-amber-300">{err}</p>}
      {mode === "void" ? (
        <>
          <p className="text-xs text-slate-400">Voids work for sales from this shift. Stock goes back and the sale leaves the drawer total.</p>
          <input className="guma-field h-10" placeholder="Reason (e.g. wrong item rung)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <button type="button" className={`${btnPrimary} w-full bg-red-600`} disabled={busy || !reason.trim()} onClick={() => void submitVoid()} data-testid="pos-void-confirm">
            {busy ? "Voiding…" : `Void ${peso(receipt.totals.total)}`}
          </button>
        </>
      ) : (
        <>
          {!lines ? (
            <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading items…</p>
          ) : (
            <ul className="space-y-1.5">
              {lines.map((l) => {
                const left = l.quantity - l.returnedQty;
                const q = qty[l.orderItemId] ?? 0;
                return (
                  <li key={l.orderItemId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs">{l.title}</span>
                    {left > 0 ? (
                      <span className="flex items-center gap-1">
                        <button type="button" className="rounded border border-white/15 p-1" onClick={() => setQty({ ...qty, [l.orderItemId]: Math.max(0, q - 1) })} aria-label="Less"><Minus className="h-3 w-3" /></button>
                        <span className="w-5 text-center text-xs font-semibold">{q}</span>
                        <button type="button" className="rounded border border-white/15 p-1" onClick={() => setQty({ ...qty, [l.orderItemId]: Math.min(left, q + 1) })} aria-label="More"><Plus className="h-3 w-3" /></button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">returned</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put back in stock
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input className="guma-field h-10" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Refund ₱" aria-label="Refund amount" />
            <select className="guma-field h-10" value={method} onChange={(e) => setMethod(e.target.value as PosTenderMethod)} aria-label="Refund by">
              {(["cash", "gcash", "maya", "card"] as const).map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <input className="guma-field h-10" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          <button type="button" className={`${btnPrimary} w-full`} disabled={busy || (!Object.values(qty).some((n) => n > 0) && !Number(amount))} onClick={() => void submitReturn()} data-testid="pos-return-confirm">
            {busy ? "Saving…" : Number(amount) > 0 ? `Refund ${peso(Number(amount))}` : "Record return"}
          </button>
        </>
      )}
      <button type="button" className="w-full text-xs text-slate-400 hover:text-white" onClick={() => setMode(null)}>Cancel</button>
    </div>
  );
}

function SalesModal({
  sales,
  summary,
  onClose,
  onOpen,
  queued,
  onOpenQueued,
}: {
  sales: SaleRow[];
  summary: Summary | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  queued: Receipt[];
  onOpenQueued: (r: Receipt) => void;
}) {
  return (
    <Modal title="This shift's sales" onClose={onClose}>
      {queued.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/5 p-2">
          <p className="px-1 text-xs font-semibold text-amber-200">Waiting to send ({queued.length}) — not in the totals yet</p>
          <ul className="divide-y divide-white/10" data-testid="pos-queued">
            {[...queued].reverse().map((r) => (
              <li key={r.orderId}>
                <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm" onClick={() => onOpenQueued(r)}>
                  <span className="w-16 text-xs text-slate-400">{new Date(r.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>
                  <span className="min-w-0 flex-1">
                    {r.invoiceNumber ? `No. ${r.invoiceNumber}` : "Offline sale"} · {r.items.reduce((n, i) => n + i.quantity, 0)} item(s)
                    <span className="block text-xs text-slate-500">{r.cashierName}</span>
                  </span>
                  <span className="font-semibold">{peso(r.totals.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-slate-400">Sales</p>
            <p className="text-lg font-bold">{summary.sales}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-slate-400">Total</p>
            <p className="text-lg font-bold">{peso(summary.salesTotal)}</p>
          </div>
        </div>
      )}
      {sales.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No sales yet.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {sales.map((s) => (
            <li key={s.orderId}>
              <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left text-sm" onClick={() => onOpen(s.orderId)}>
                <span className="w-16 text-xs text-slate-400">{new Date(s.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1">
                  #{s.orderNumber} · {s.itemCount} item{s.itemCount === 1 ? "" : "s"}
                  <span className="block text-xs text-slate-500">
                    {s.cashierName} · {METHOD_LABEL[(s.method as PosTenderMethod) ?? "cash"] ?? s.method}
                  </span>
                </span>
                <span className="font-semibold">{peso(s.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function CloseShiftModal({ shift, summary, onClose, onClosed }: { shift: Shift; summary: Summary; onClose: () => void; onClosed: () => void }) {
  const [counted, setCounted] = useState<Record<PosTenderMethod, string>>({
    cash: "",
    gcash: summary.expected.gcash ? summary.expected.gcash.toFixed(2) : "0",
    maya: summary.expected.maya ? summary.expected.maya.toFixed(2) : "0",
    card: summary.expected.card ? summary.expected.card.toFixed(2) : "0",
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ variance: Tenders; counted: Tenders; expected: Tenders } | null>(null);

  const methods = (["cash", "gcash", "maya", "card"] as const).filter((m) => m === "cash" || summary.expected[m] > 0 || Number(counted[m]) > 0);

  if (result) {
    const totalVariance = Object.values(result.variance).reduce((a, b) => a + b, 0);
    return (
      <Modal title="Shift closed" onClose={onClosed}>
        <ul className="space-y-2 text-sm">
          {(Object.keys(result.expected) as PosTenderMethod[])
            .filter((m) => result.expected[m] !== 0 || result.counted[m] !== 0)
            .map((m) => (
              <li key={m} className="flex justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>{METHOD_LABEL[m]}</span>
                <span>
                  {peso(result.counted[m])} counted ·{" "}
                  <span className={result.variance[m] === 0 ? "text-emerald-300" : result.variance[m] < 0 ? "text-red-300" : "text-amber-300"}>
                    {result.variance[m] === 0 ? "balanced" : `${result.variance[m] > 0 ? "+" : ""}${peso(result.variance[m])}`}
                  </span>
                </span>
              </li>
            ))}
        </ul>
        <p className={`mt-3 text-center text-sm font-semibold ${totalVariance === 0 ? "text-emerald-300" : "text-amber-300"}`} data-testid="pos-close-result">
          {totalVariance === 0 ? "Balanced — nice!" : totalVariance < 0 ? `Short by ${peso(-totalVariance)}` : `Over by ${peso(totalVariance)}`}
        </p>
        <button type="button" className={`${btnPrimary} mt-4 w-full`} onClick={onClosed}>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Close shift" onClose={onClose}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-white/5 p-2">
          <p className="text-xs text-slate-400">Sales</p>
          <p className="font-bold">{summary.sales}</p>
        </div>
        <div className="rounded-xl bg-white/5 p-2">
          <p className="text-xs text-slate-400">Total</p>
          <p className="font-bold">{peso(summary.salesTotal)}</p>
        </div>
        <div className="rounded-xl bg-white/5 p-2">
          <p className="text-xs text-slate-400">Senior/PWD</p>
          <p className="font-bold">{summary.seniorPwdSales}</p>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        Count the drawer. Expected cash = {peso(shift.openingCash)} opening + {peso(summary.byMethod.cash)} from sales.
      </p>
      <div className="mt-3 space-y-3">
        {methods.map((m) => {
          const variance = counted[m] === "" ? null : Math.round((Number(counted[m]) - summary.expected[m]) * 100) / 100;
          return (
            <div key={m} className="grid grid-cols-[1fr_auto] items-end gap-3">
              <MoneyInput label={`${METHOD_LABEL[m]} counted`} value={counted[m]} onChange={(v) => setCounted({ ...counted, [m]: v })} autoFocus={m === "cash"} />
              <div className="pb-2 text-right text-xs">
                <p className="text-slate-400">Expected {peso(summary.expected[m])}</p>
                {variance !== null && (
                  <p className={variance === 0 ? "text-emerald-300" : variance < 0 ? "text-red-300" : "text-amber-300"}>
                    {variance === 0 ? "Balanced" : `${variance > 0 ? "+" : ""}${peso(variance)}`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <textarea className="guma-field h-20 py-2" placeholder="Note (optional) — e.g. paid ₱50 for ice" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        type="button"
        className={`${btnPrimary} mt-4 w-full`}
        disabled={busy || counted.cash === ""}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const body = {
            shiftId: shift.id,
            counted: { cash: Number(counted.cash || 0), gcash: Number(counted.gcash || 0), maya: Number(counted.maya || 0), card: Number(counted.card || 0) },
            note: note || undefined,
          };
          const r = await api<{ shift: { variance: Tenders; counted: Tenders; expected: Tenders } }>("/api/pos/shift/close", { method: "POST", body: JSON.stringify(body) });
          setBusy(false);
          if (!r.ok) return setError(r.error ?? "Could not close the shift.");
          setResult({ variance: r.shift.variance, counted: r.shift.counted, expected: r.shift.expected });
        }}
        data-testid="pos-close-confirm"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Close shift
      </button>
    </Modal>
  );
}
