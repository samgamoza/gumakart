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
  X,
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

// ─── Types (API shapes) ──────────────────────────────────────────────────────

interface Product {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  stockQty: number | null;
  trackInventory: boolean;
  imageUrl: string | null;
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
  actor: { name: string; role: "owner" | "manager" | "cashier"; isStaff: boolean };
  shop: { name: string; slug: string };
  shift: Shift | null;
  summary: Summary | null;
  sales: SaleRow[];
  vat: VatConfig;
  wallets: { gcash: boolean; maya: boolean };
  deviceRegistered: boolean;
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
    <div id="pos-receipt" className="mx-auto w-full max-w-[320px] rounded-xl bg-white p-4 font-mono text-[12px] leading-5 text-black">
      <p className="text-center text-sm font-bold">{r.shopName}</p>
      <p className="text-center">Sale #{r.orderNumber}</p>
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
      <p className="text-center">Salamat po!</p>
      <p className="text-center text-[10px]">This is not an official receipt.</p>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function PosRegister() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Array<{ product: Product; qty: number }>>([]);
  const [discountType, setDiscountType] = useState<PosDiscountType>("none");
  const [holder, setHolder] = useState({ name: "", idNumber: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "pay" | "receipt" | "close" | "sales" | "cart">(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await api<State>("/api/pos/state");
    if (!data.ok) {
      if (data.code === "POS_LOCKED") {
        router.replace("/pos/login");
        return;
      }
      setLoadError(data.error ?? "Could not load the register.");
      return;
    }
    setLoadError(null);
    setState(data);
  }, [router]);

  const loadProducts = useCallback(async () => {
    const data = await api<{ products: Product[] }>("/api/pos/products");
    if (data.ok) setProducts(data.products);
  }, []);

  useEffect(() => {
    void load();
    void loadProducts();
  }, [load, loadProducts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.title.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase() === q);
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

  function add(p: Product) {
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
    const exact = products.find((p) => (p.sku ?? "").toLowerCase() === q) ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (exact) {
      add(exact);
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
        {state.shift && (
          <>
            <button type="button" className={`${btnGhost} px-3`} onClick={() => setModal("sales")}>
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Sales</span>
              <span className="rounded-full bg-white/10 px-1.5 text-xs">{state.summary?.sales ?? 0}</span>
            </button>
            <button type="button" className={`${btnGhost} px-3`} onClick={() => setModal("close")}>
              Close shift
            </button>
          </>
        )}
        {(state.actor.isStaff || state.deviceRegistered) && (
          <button type="button" className={`${btnGhost} px-3`} onClick={() => void lock()} aria-label="Lock register">
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Lock</span>
          </button>
        )}
      </header>

      {isOwner && !state.deviceRegistered && (
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
                  const left = p.trackInventory && p.stockQty !== null ? p.stockQty - inCart(p.id) : null;
                  const out = left !== null && left <= 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => add(p)}
                        disabled={out}
                        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left transition hover:border-violet-400/60 active:scale-[0.98] disabled:opacity-40"
                        data-testid="pos-product"
                      >
                        <div className="aspect-[4/3] w-full bg-white/5">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={productImageSrc(p.imageUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-2xl font-bold text-white/20">{p.title.slice(0, 1)}</div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-2">
                          <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
                          <span className="mt-auto flex items-center justify-between pt-1">
                            <span className="font-bold text-violet-200">{peso(p.price)}</span>
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

      {modal === "pay" && state.shift && (
        <PayModal
          total={totals.total}
          wallets={state.wallets}
          onClose={() => setModal(null)}
          submit={async (tenders, customer, key) => {
            const r = await api<{ receipt: Receipt }>("/api/pos/sales", {
              method: "POST",
              body: JSON.stringify({
                idempotencyKey: key,
                items: cart.map((l) => ({ productId: l.product.id, quantity: l.qty })),
                discountType,
                discountHolder: discountType !== "none" ? holder : undefined,
                tenders,
                customer,
              }),
            });
            if (!r.ok) return r.error ?? "Could not save the sale.";
            setReceipt(r.receipt);
            setModal("receipt");
            void load();
            void loadProducts();
            return null;
          }}
        />
      )}

      {modal === "receipt" && receipt && (
        <Modal title={receipt.duplicate ? "Sale already saved" : "Sale complete"} wide>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <ReceiptView r={receipt} vat={state.vat} />
            <ReceiptActions receipt={receipt} onNewSale={resetSale} />
          </div>
        </Modal>
      )}

      {modal === "sales" && state.shift && (
        <SalesModal
          sales={state.sales}
          summary={state.summary}
          onClose={() => setModal(null)}
          onOpen={async (id) => {
            const r = await api<{ receipt: Receipt }>(`/api/pos/sales/${id}`);
            if (r.ok) {
              setReceipt({ ...r.receipt, duplicate: false });
              setModal("receipt");
            }
          }}
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
  cart: Array<{ product: Product; qty: number }>;
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
}: {
  total: number;
  wallets: { gcash: boolean; maya: boolean };
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
      <button type="button" className={`${btnPrimary} w-full py-3`} onClick={onNewSale} autoFocus data-testid="pos-new-sale">
        New sale
      </button>
    </div>
  );
}

function SalesModal({ sales, summary, onClose, onOpen }: { sales: SaleRow[]; summary: Summary | null; onClose: () => void; onOpen: (id: string) => void }) {
  return (
    <Modal title="This shift's sales" onClose={onClose}>
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
