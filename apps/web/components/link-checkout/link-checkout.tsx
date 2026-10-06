"use client";

import { GiftCardInput, type AppliedGiftCard } from "@/components/gift-card-input";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, MapPin, Minus, Plus, ShieldCheck, Store, Truck } from "lucide-react";
import { computeCheckoutTotals, type TenantCheckoutJson } from "@gumakart/db/checkout";
import { AddressSelect } from "@/components/kart/address-select";
import { GumaIdSignIn } from "@/components/guma-id/sign-in";
import { maskPhone, toKartAddress, useGumaId } from "@/components/guma-id/use-guma-id";
import { Field, SectionTitle } from "@/components/kart/ui";
import { EMPTY_ADDRESS, formatAddress, isAddressComplete, type KartAddress } from "@/lib/kart/ph-address";

// ─── Data from the server page ───────────────────────────────────────────────

export type LinkPaymentId = "gcash" | "paymaya" | "cod" | "bank" | "qrph" | "card";

export interface LinkPaymentOption {
  id: LinkPaymentId;
  label: string;
  note: string;
}

export interface LinkCheckoutData {
  code: string;
  shop: { name: string; slug: string; logoUrl: string | null };
  items: Array<{
    /** Line key: variantId, else productId. Quantities are keyed by this. */
    key: string;
    productId: string;
    title: string;
    variantTitle: string | null;
    price: number;
    imageUrl: string | null;
    quantity: number;
    maxQuantity: number;
  }>;
  allowQuantityEdit: boolean;
  delivery: boolean;
  pickup: boolean;
  pickupAddress: string | null;
  payments: LinkPaymentOption[];
  checkout: TenantCheckoutJson;
  couponCode: string | null;
  minOrderAmount: number;
  requireEmail: boolean;
  utm: Record<string, string> | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function peso(n: number): string {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;
}

/** 0917 123 4567 / +63 917… / 917… → 09171234567, or null. */
function phMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return null;
}

function sessionKeyFor(code: string): string {
  const key = `guma-link-session:${code}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID().replace(/-/g, "");
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

type Errors = Partial<Record<"name" | "phone" | "email" | "method" | "form" | keyof KartAddress, string>>;

// ─── Component ───────────────────────────────────────────────────────────────

export function LinkCheckout({ data }: { data: LinkCheckoutData }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.items.map((i) => [i.key, Math.min(i.quantity, Math.max(1, i.maxQuantity))]))
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(data.delivery ? "delivery" : "pickup");
  const [address, setAddress] = useState<KartAddress>(EMPTY_ADDRESS);
  const [method, setMethod] = useState<LinkPaymentId | null>(data.payments.length === 1 ? data.payments[0]!.id : null);
  const [smsConsent, setSmsConsent] = useState(false);
  // Phase 12: Guma ID pre-fill (buyer's own saved details, never shown to other shops).
  const gid = useGumaId();
  const [gidOpen, setGidOpen] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const [fromSaved, setFromSaved] = useState<string | null>(null);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!gid.buyer || prefilled.current) return;
    prefilled.current = true;
    const b = gid.buyer;
    setName((n) => n || b.name || "");
    setPhone(b.phone);
    const def = gid.addresses.find((a) => a.isDefault) ?? gid.addresses[0];
    if (def) {
      setAddress((cur) => (cur.line1 || cur.cityCode ? cur : toKartAddress(def.address)));
      setFromSaved(def.id);
    }
    if (b.preferredPayment && data.payments.some((p) => p.id === b.preferredPayment)) {
      setMethod((m) => m ?? (b.preferredPayment as LinkPaymentId));
    }
    setGidOpen(false);
  }, [gid.buyer, gid.addresses, data.payments]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<{ fee: number; etaMinutes: number | null; live: boolean } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const sessionKey = useRef<string>("");

  useEffect(() => {
    sessionKey.current = sessionKeyFor(data.code);
  }, [data.code]);

  const subtotal = useMemo(
    () => data.items.reduce((sum, i) => sum + i.price * (quantities[i.key] ?? i.quantity), 0),
    [data.items, quantities]
  );

  const addressReady = fulfillment === "delivery" && isAddressComplete(address);
  const addressText = addressReady
    ? formatAddress(address) + (address.landmark.trim() ? ` (near ${address.landmark.trim()})` : "")
    : "";

  // Live delivery fee as soon as the address is complete (shown before the button).
  useEffect(() => {
    if (fulfillment !== "delivery" || !addressReady) {
      setQuote(null);
      return;
    }
    let alive = true;
    setQuoting(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/delivery/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tenantSlug: data.shop.slug,
            address: addressText,
            subtotal,
            city: address.city,
            barangay: address.barangay,
            province: address.province,
          }),
        });
        const json = await res.json();
        if (alive && json.ok) setQuote({ fee: Number(json.fee) || 0, etaMinutes: json.etaMinutes ?? null, live: Boolean(json.live) });
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [fulfillment, addressReady, addressText, subtotal, data.shop.slug, address.city, address.barangay, address.province]);

  const deliveryFee = fulfillment === "pickup" ? 0 : quote?.fee ?? null;
  const totals = computeCheckoutTotals({
    subtotal,
    deliveryFee: deliveryFee ?? 0,
    checkout: data.checkout,
    couponCode: data.couponCode ?? undefined,
    lines: data.items.map((i) => ({ productId: i.productId, quantity: quantities[i.key] ?? i.quantity, lineTotal: i.price * (quantities[i.key] ?? i.quantity) })),
  });
  const belowMinimum = data.minOrderAmount > 0 && subtotal < data.minOrderAmount;
  // Phase 17: gift card / store credit pays first.
  const [giftCard, setGiftCard] = useState<AppliedGiftCard | null>(null);
  const giftApplied = giftCard ? Math.min(giftCard.balance, totals.total) : 0;
  const amountDue = Math.max(0, Math.round((totals.total - giftApplied) * 100) / 100);

  // Save progress once the buyer has given a valid number (counts as "started checkout").
  const savedFor = useRef<string>("");
  useEffect(() => {
    const mobile = phMobile(phone);
    if (!mobile || !sessionKey.current) return;
    const snapshot = JSON.stringify([mobile, name.trim(), smsConsent, addressText, quantities]);
    if (snapshot === savedFor.current) return;
    const timer = window.setTimeout(() => {
      savedFor.current = snapshot;
      void fetch(`/api/c/${data.code}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionKey: sessionKey.current,
          customer: { name: name.trim() || undefined, phone: mobile },
          address: addressText ? { line1: addressText } : undefined,
          quantities,
          smsConsent,
          utm: data.utm ?? undefined,
        }),
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [phone, name, smsConsent, addressText, quantities, data.code, data.utm]);

  function setQty(key: string, next: number, max: number) {
    setQuantities((q) => ({ ...q, [key]: Math.max(1, Math.min(max, next)) }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Pakilagay ang pangalan mo.";
    if (!phMobile(phone)) e.phone = "Maglagay ng PH mobile number, hal. 0917 123 4567.";
    if (data.requireEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Pakilagay ang email mo.";
    if (fulfillment === "delivery") {
      if (!address.regionCode) e.regionCode = "Piliin ang region mo.";
      if (!address.provinceCode) e.provinceCode = "Piliin ang province mo.";
      if (!address.cityCode) e.cityCode = "Piliin ang city o municipality mo.";
      if (!address.barangay) e.barangay = "Piliin ang barangay mo.";
      if (address.line1.trim().length < 5) e.line1 = "Ilagay ang house no. at street.";
    }
    if (!method) e.method = "Pumili kung paano ka magbabayad.";
    return e;
  }

  async function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.setTimeout(() => {
        document.querySelector('[aria-invalid="true"], [data-error="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/c/${data.code}/order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionKey: sessionKey.current || undefined,
          quantities: data.allowQuantityEdit ? quantities : undefined,
          paymentMethod: method,
          fulfillment,
          smsConsent,
          giftCardCode: giftCard?.code,
          customer: { name: name.trim(), phone: phMobile(phone), email: email.trim() || undefined },
          ...(fulfillment === "delivery"
            ? {
                address: addressText,
                street1: address.line1.trim(),
                city: address.city,
                barangay: address.barangay,
                province: address.province,
                notes: address.landmark.trim() ? `Landmark: ${address.landmark.trim()}` : undefined,
              }
            : {}),
          utm: data.utm ?? undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors({ form: json.error ?? "May problema. Pakisubukan ulit." });
        setSubmitting(false);
        return;
      }
      try {
        window.localStorage.removeItem(`guma-link-session:${data.code}`);
      } catch {}
      // Guma ID: keep a new delivery address for next time (best effort, 3s max).
      if (gid.buyer && fulfillment === "delivery" && saveAddress && !fromSaved) {
        await Promise.race([
          fetch("/api/id/addresses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, makeDefault: gid.addresses.length === 0 }) }).catch(() => null),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      }
      window.location.href = json.redirectUrl ?? json.orderUrl;
    } catch {
      setErrors({ form: "Walang connection. I-check ang signal mo at subukan ulit." });
      setSubmitting(false);
    }
  }

  const labelOf = (m: LinkPaymentOption) => (m.id === "cod" && fulfillment === "pickup" ? "Cash on pickup" : m.label);
  const selected = data.payments.find((p) => p.id === method);
  const methodLabel = selected ? labelOf(selected) : null;

  let step = 0;

  return (
    <div className="min-h-dvh lg:bg-slate-100">
    <div className="mx-auto w-full max-w-md pb-36 lg:max-w-5xl lg:px-6 lg:pb-12 lg:pt-6">
      {/* Seller header: the buyer is ordering from the shop they follow */}
      <header className="flex items-center gap-3 border-b border-[color:var(--kart-line)] bg-white px-4 py-3 lg:mx-3 lg:mb-2 lg:rounded-2xl lg:border">
        {data.shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.shop.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--kart-orange-soft)] text-sm font-extrabold text-[color:var(--kart-orange-dark)]">
            {data.shop.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold leading-tight">{data.shop.name}</p>
          <p className="text-[11px] text-[color:var(--kart-muted)]">Order form · walang app o account na kailangan</p>
        </div>
      </header>

      {/* Phones: one column (items → form → fees, sticky button).
          PC: form on the left, order summary + button on the right, staying in view. */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <aside className="contents lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:block">
      {/* Order review */}
      <section className="k-card order-1 m-3 divide-y divide-[color:var(--kart-line)] lg:mt-3">
        <p className="hidden px-4 pb-2 pt-3 text-xs font-bold uppercase tracking-wider text-[color:var(--kart-muted)] lg:block">Ang order mo</p>
        {data.items.map((item) => {
          const qty = quantities[item.key] ?? item.quantity;
          const soldOut = item.maxQuantity < 1;
          return (
            <div key={item.key} className="flex items-center gap-3 p-3">
              <div className="h-16 w-16 flex-none overflow-hidden rounded-xl bg-slate-100 lg:h-20 lg:w-20">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="eager" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-tight">{item.title}</p>
                {item.variantTitle && <p className="text-xs text-[color:var(--kart-muted)]">{item.variantTitle}</p>}
                <p className="mt-1 text-[15px] font-extrabold">{peso(item.price)}</p>
                {soldOut && <p className="text-xs font-semibold text-[color:var(--kart-danger)]">Ubos na</p>}
              </div>
              {data.allowQuantityEdit && !soldOut ? (
                <div className="flex flex-none items-center rounded-xl border-[1.5px] border-[color:var(--kart-line)]">
                  <button
                    type="button"
                    aria-label={`Bawasan ang ${item.title}`}
                    onClick={() => setQty(item.key, qty - 1, item.maxQuantity)}
                    disabled={qty <= 1}
                    className="flex h-10 w-10 items-center justify-center disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-7 text-center text-base font-bold tabular-nums">{qty}</span>
                  <button
                    type="button"
                    aria-label={`Dagdagan ang ${item.title}`}
                    onClick={() => setQty(item.key, qty + 1, item.maxQuantity)}
                    disabled={qty >= item.maxQuantity}
                    className="flex h-10 w-10 items-center justify-center disabled:opacity-30"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="flex-none text-sm font-bold text-[color:var(--kart-muted)]">× {qty}</span>
              )}
            </div>
          );
        })}
      </section>
      {/* Fees, always above the button */}
      <section className="order-3 m-3 mt-6 lg:mt-3">
        <div className="k-card grid gap-2 p-4 text-sm">
          <Row label={`Items (${data.items.reduce((n, i) => n + (quantities[i.key] ?? i.quantity), 0)})`} value={peso(totals.subtotal)} />
          {totals.discount > 0 && <Row label={totals.discountLabel ?? "Discount"} value={`−${peso(totals.discount)}`} />}
          {totals.tax > 0 && <Row label="Tax" value={peso(totals.tax)} />}
          <Row
            label={fulfillment === "pickup" ? "Pickup" : "Delivery"}
            value={fulfillment === "pickup" ? "Libre" : deliveryFee == null ? "—" : deliveryFee > 0 ? peso(deliveryFee) : "Libre"}
            muted={fulfillment === "delivery" && deliveryFee == null}
          />
          <div className="my-1 border-t border-dashed border-[color:var(--kart-line)]" />
          <Row label="Total" value={peso(totals.total)} bold={giftApplied === 0} />
          {giftApplied > 0 && (
            <>
              <Row label={giftCard?.kind === "store_credit" ? "Store credit" : "Gift card"} value={`−${peso(giftApplied)}`} />
              <Row label="Babayaran" value={peso(amountDue)} bold />
            </>
          )}
          <div className="mt-2">
            <GiftCardInput tenantSlug={data.shop.slug} value={giftCard} onChange={setGiftCard} tone="neutral" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || belowMinimum || data.payments.length === 0}
          className="k-btn k-btn-primary mt-3 hidden w-full text-[15px] lg:flex"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Pinapadala ang order mo…" : `I-place ang order · ${peso(amountDue)}`}
        </button>
        {methodLabel && <p className="mt-2 hidden text-center text-xs text-[color:var(--kart-muted)] lg:block">Bayad: {methodLabel}</p>}
        {belowMinimum && (
          <p className="mt-3 rounded-xl bg-[color:var(--kart-orange-soft)] px-4 py-3 text-xs font-medium text-[color:var(--kart-orange-dark)]">
            {peso(data.minOrderAmount)} ang minimum order ng shop na ito. Magdagdag pa para tumuloy.
          </p>
        )}
        {errors.form && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-[color:var(--kart-danger)]" role="alert">
            {errors.form}
          </p>
        )}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-[color:var(--kart-muted)]">
          <ShieldCheck className="h-3.5 w-3.5" /> Secure checkout ng Guma Kart
        </p>
      </section>

      </aside>

      <div className="order-2 lg:col-start-1 lg:row-start-1">
      {/* Contact */}
      <section className="m-3 mt-5 grid gap-3">
        <SectionTitle n={++step}>Ang iyong detalye</SectionTitle>
        {gid.available && !gid.buyer && (
          <div className="k-card p-3" data-testid="guma-id-bar">
            {!gidOpen ? (
              <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm" onClick={() => setGidOpen(true)}>
                <span>
                  <span className="font-semibold">⚡ May Guma ID ka?</span>{" "}
                  <span className="text-[color:var(--kart-muted)]">Mag-sign in para auto-fill ang detalye mo.</span>
                </span>
                <span className="shrink-0 font-semibold underline">Sign in</span>
              </button>
            ) : (
              <GumaIdSignIn compact defaultPhone={phone} onSignedIn={() => gid.refresh()} />
            )}
          </div>
        )}
        {gid.buyer && (
          <div className="k-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="guma-id-signed-in">
            <span>
              ✓ Guma ID: <strong>{maskPhone(gid.buyer.phone)}</strong>
            </span>
            {gid.addresses.length > 1 && fulfillment === "delivery" && (
              <select
                className="k-input h-9 w-auto py-0 text-sm"
                value={fromSaved ?? ""}
                onChange={(e) => {
                  const a = gid.addresses.find((x) => x.id === e.target.value);
                  if (a) {
                    setAddress(toKartAddress(a.address));
                    setFromSaved(a.id);
                  }
                }}
                aria-label="Saved address"
              >
                <option value="">Bagong address</option>
                {gid.addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.address.city || "Address"}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="k-card grid gap-4 p-4">
          <Field label="Pangalan" error={errors.name}>
            <input
              className="k-input"
              value={name}
              aria-invalid={Boolean(errors.name)}
              autoComplete="name"
              placeholder="Juan dela Cruz"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Mobile number" error={errors.phone} hint="Dito namin ite-text ang updates ng order mo.">
            <input
              className="k-input"
              value={phone}
              aria-invalid={Boolean(errors.phone)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="0917 123 4567"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          {data.requireEmail && (
            <Field label="Email" error={errors.email}>
              <input
                className="k-input"
                type="email"
                value={email}
                aria-invalid={Boolean(errors.email)}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}
        </div>
      </section>

      {/* Delivery or pickup */}
      <section className="m-3 mt-6 grid gap-3">
        <SectionTitle n={++step}>{data.delivery && data.pickup ? "Delivery o pickup?" : data.pickup ? "Pickup" : "Saan namin ide-deliver?"}</SectionTitle>
        {data.delivery && data.pickup && (
          <div role="radiogroup" aria-label="Delivery o pickup" className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "delivery", label: "Ipa-deliver", icon: Truck },
                { id: "pickup", label: "Ipi-pickup ko", icon: Store },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={fulfillment === o.id}
                onClick={() => setFulfillment(o.id)}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 bg-white px-3 py-3 text-sm font-bold ${
                  fulfillment === o.id ? "border-[color:var(--kart-ink)]" : "border-[color:var(--kart-line)]"
                }`}
              >
                <o.icon className="h-4 w-4" /> {o.label}
              </button>
            ))}
          </div>
        )}

        {fulfillment === "delivery" ? (
          <>
            <div className="k-card p-4">
              <AddressSelect
                value={address}
                onChange={(next) => {
                  setAddress(next);
                  setFromSaved(null);
                }}
                errors={errors}
                lang="tl"
              />
              {gid.buyer && !fromSaved && (
                <label className="flex items-center gap-2 text-sm text-[color:var(--kart-muted)]">
                  <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> I-save ang address na ito sa Guma ID
                </label>
              )}
            </div>
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                quote ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-white"
              }`}
            >
              <Truck className={`h-5 w-5 shrink-0 ${quote ? "text-emerald-700" : "text-slate-400"}`} />
              {quoting ? (
                <p className="flex items-center gap-2 text-sm text-[color:var(--kart-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Kinukuha ang delivery fee…
                </p>
              ) : quote ? (
                <p className="text-sm">
                  <span className="font-bold">Delivery {quote.fee > 0 ? peso(quote.fee) : "libre"}</span>
                  {quote.etaMinutes ? (
                    <span className="text-[color:var(--kart-muted)]"> · mga {Math.round(quote.etaMinutes / 60) || 1} oras</span>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-[color:var(--kart-muted)]">Ilagay ang address mo para makita ang delivery fee.</p>
              )}
            </div>
          </>
        ) : (
          <div className="k-card flex items-start gap-3 p-4">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--kart-orange-dark)]" />
            <div className="text-sm">
              <p className="font-bold">Kunin sa {data.shop.name}</p>
              <p className="text-[color:var(--kart-muted)]">
                {data.pickupAddress || "Ite-text sa iyo ng seller ang pickup details."}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Payment */}
      <section className="m-3 mt-6 grid gap-3" data-error={Boolean(errors.method)}>
        <SectionTitle n={++step}>Paano ka magbabayad?</SectionTitle>
        <div role="radiogroup" aria-label="Paraan ng pagbabayad" className="grid gap-2.5">
          {data.payments.map((m) => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMethod(m.id)}
                className={`flex items-center gap-3 rounded-xl border-2 bg-white p-3.5 text-left ${
                  active ? "border-[color:var(--kart-ink)]" : "border-[color:var(--kart-line)]"
                }`}
              >
                <MethodMark id={m.id} />
                <span className="flex-1">
                  <span className="block text-sm font-bold">{labelOf(m)}</span>
                  <span className="block text-xs text-[color:var(--kart-muted)]">
                    {m.id === "cod" && fulfillment === "pickup" ? "Magbayad ng cash pag-pickup" : m.note}
                  </span>
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    active ? "border-[color:var(--kart-ink)] bg-[color:var(--kart-ink)] text-white" : "border-slate-300"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {errors.method && <p className="text-xs font-medium text-[color:var(--kart-danger)]">{errors.method}</p>}
        <label className="mt-1 flex items-start gap-2.5 text-xs text-[color:var(--kart-muted)]">
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(e) => setSmsConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#ff6b00]"
          />
          <span>
            I-text ako ng paalala tungkol sa order na ito (hal. kung hindi ko pa natapos magbayad). May link sa
            bawat paalala para itigil ito. Laging ipapadala ang order updates.
          </span>
        </label>
      </section>

      </div>
      </div>

      {/* Sticky total + button (phones; PC has the button in the summary) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--kart-line)] bg-white/95 backdrop-blur safe-bottom lg:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3 p-3">
          <div className="min-w-[84px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--kart-muted)]">Total</p>
            <p className="text-lg font-extrabold leading-tight tabular-nums">{peso(amountDue)}</p>
            {methodLabel && <p className="text-[11px] text-[color:var(--kart-muted)]">{methodLabel}</p>}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || belowMinimum || data.payments.length === 0}
            className="k-btn k-btn-primary flex-1 text-[15px]"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "Pinapadala ang order mo…" : "I-place ang order"}
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${bold ? "text-base font-extrabold" : ""}`}>
      <span className={muted ? "text-[color:var(--kart-muted)]" : ""}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-[color:var(--kart-muted)]" : ""}`}>{value}</span>
    </div>
  );
}

function MethodMark({ id }: { id: LinkPaymentId }) {
  const box = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white";
  if (id === "gcash") return <span className={box} style={{ background: "var(--kart-gcash)" }}>G</span>;
  if (id === "paymaya") return <span className={box} style={{ background: "var(--kart-maya)" }}>M</span>;
  if (id === "bank") return <span className={`${box} bg-slate-600`}>₱</span>;
  if (id === "qrph") return <span className={`${box} bg-indigo-600`}>QR</span>;
  if (id === "card") return <span className={`${box} bg-slate-500`}>▭</span>;
  return (
    <span className={`${box} bg-slate-800`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    </span>
  );
}
