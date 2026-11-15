"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, ShieldCheck, Truck } from "lucide-react";
import { EMPTY_ADDRESS, formatAddress, type KartAddress } from "@/lib/kart/ph-address";
import {
  CART_HOLD_MINUTES,
  computeTotals,
  makeOrderNumber,
  normalizePhMobile,
  ORDER_STORAGE_KEY,
  peso,
  PRODUCT,
  quoteShipping,
  SELLER,
  type PaymentMethod,
  type PlacedOrder,
} from "@/lib/kart/demo";
import { AddressSelect } from "./address-select";
import { PaymentPicker } from "./payment-picker";
import { Field, ProductThumb, SectionTitle } from "./ui";

/*
  Localized one-page mobile checkout (spec §C).
  1 Order review · 2 Shipping (strict PSGC dropdowns) · 3 Payment · 4 sticky CTA.
  Fees are shown line by line before the CTA (spec §3.3). No images fetched.
*/
type Errors = Partial<Record<"name" | "phone" | keyof KartAddress | "method", string>>;

export function Checkout() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<KartAddress>(EMPTY_ADDRESS);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CART_HOLD_MINUTES * 60);

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const shipping = useMemo(() => quoteShipping(address.regionCode, address.provinceCode), [address.regionCode, address.provinceCode]);
  const totals = computeTotals(PRODUCT.price, shipping?.amount ?? null, method);
  const expired = secondsLeft === 0;
  const lowTime = secondsLeft > 0 && secondsLeft <= 60;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  function validate(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Please enter your full name.";
    if (!normalizePhMobile(phone)) e.phone = "Enter a PH mobile number, e.g. 0917 123 4567.";
    if (!address.regionCode) e.regionCode = "Select your region.";
    if (!address.provinceCode) e.provinceCode = "Select your province.";
    if (!address.cityCode) e.cityCode = "Select your city or municipality.";
    if (!address.barangay) e.barangay = "Select your barangay.";
    if (!address.line1.trim()) e.line1 = "Add your house number and street.";
    if (!method) e.method = "Choose how you'd like to pay.";
    return e;
  }

  async function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.querySelector('[aria-invalid="true"], [data-error="true"]');
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!shipping || !method) return;
    setSubmitting(true);
    const order: PlacedOrder = {
      number: makeOrderNumber(),
      placedAt: new Date().toISOString(),
      buyer: { name: name.trim(), phone: normalizePhMobile(phone)! },
      addressText: formatAddress(address) + (address.landmark ? ` (${address.landmark})` : ""),
      method,
      totals,
      shipping,
      product: PRODUCT,
    };
    // Demo persistence only. Real flow: POST /api/kart/orders → payment intent → webhook.
    try {
      sessionStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
    router.push(`/kart/track?order=${order.number}`);
  }

  return (
    <div className="mx-auto w-full max-w-md pb-40">
      {/* 1. Order review banner */}
      <section className="k-card m-3 flex items-center gap-3 p-3">
        <ProductThumb size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold leading-tight">{PRODUCT.title}</p>
          <p className="text-xs text-[color:var(--kart-muted)]">{PRODUCT.variant} · from {SELLER.name}</p>
          <p className="mt-1 text-base font-extrabold">{peso(PRODUCT.price)}</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[color:var(--kart-orange-dark)]">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {expired ? "Released" : "Reserved"}
          </p>
          <p
            className={`font-mono text-lg font-bold tabular-nums ${lowTime ? "k-pulse text-[color:var(--kart-danger)]" : ""}`}
            role="timer"
            aria-label={expired ? "Reservation released" : `Reserved for ${Number(mm)} minutes ${Number(ss)} seconds`}
          >
            {mm}:{ss}
          </p>
        </div>
      </section>

      {/* 2. Shipping matrix */}
      <section className="m-3 mt-5 grid gap-4">
        <SectionTitle n={1}>Where should BayanGo deliver?</SectionTitle>
        <div className="k-card grid gap-4 p-4">
          <Field label="Full name" error={errors.name}>
            <input className="k-input" value={name} aria-invalid={Boolean(errors.name)} autoComplete="name" placeholder="Juan dela Cruz" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile number" error={errors.phone} hint="We'll text order updates here. No email needed.">
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
          <AddressSelect value={address} onChange={setAddress} errors={errors} />
        </div>

        {/* Delivery quote appears as soon as the region is known */}
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${shipping ? "border-emerald-200 bg-emerald-50" : "border-dashed border-slate-300 bg-white"}`}>
          <Truck className={`h-5 w-5 shrink-0 ${shipping ? "text-emerald-700" : "text-slate-400"}`} />
          {shipping ? (
            <p className="text-sm">
              <span className="font-bold">BayanGo delivery {peso(shipping.amount)}</span>
              <span className="text-[color:var(--kart-muted)]"> · {shipping.eta} to {address.province}</span>
            </p>
          ) : (
            <p className="text-sm text-[color:var(--kart-muted)]">Pick your region to see the BayanGo delivery fee.</p>
          )}
        </div>
      </section>

      {/* 3. Payment */}
      <section className="m-3 mt-6 grid gap-4" data-error={Boolean(errors.method)}>
        <SectionTitle n={2}>How will you pay?</SectionTitle>
        <PaymentPicker value={method} onChange={setMethod} />
        {errors.method && <p role="alert" className="-mt-2 text-xs font-medium text-[color:var(--kart-danger)]">{errors.method}</p>}
        {method === "cod" && (
          <p className="rounded-xl bg-[color:var(--kart-orange-soft)] px-4 py-3 text-xs font-medium text-[color:var(--kart-orange-dark)]">
            COD adds a {peso(totals.codFee)} handling fee. Please prepare exact cash for the rider.
          </p>
        )}
      </section>

      {expired && (
        <section className="m-3 mt-6" role="alert">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">{`Your ${CART_HOLD_MINUTES}-minute hold ended. Nothing was charged, and your details are still here.`}</p>
            <button type="button" className="k-btn k-btn-dark shrink-0 !min-h-10 !px-4 text-sm" onClick={() => setSecondsLeft(CART_HOLD_MINUTES * 60)}>
              Reserve again
            </button>
          </div>
        </section>
      )}

      {/* Fee disclosure — always above the CTA */}
      <section className="m-3 mt-6">
        <div className="k-card grid gap-2 p-4 text-sm">
          <Row label={PRODUCT.title} value={peso(totals.subtotal)} />
          <Row label="BayanGo delivery" value={shipping ? peso(totals.shipping) : "—"} muted={!shipping} />
          {totals.codFee > 0 && <Row label="COD handling fee" value={peso(totals.codFee)} />}
          <div className="my-1 border-t border-dashed border-[color:var(--kart-line)]" />
          <Row label="Total to pay" value={peso(totals.total)} bold />
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-[color:var(--kart-muted)]">
          <ShieldCheck className="h-3.5 w-3.5" /> Secured by Guma Kart · Seller never sees your payment details
        </p>
      </section>

      {/* 4. Sticky execution bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--kart-line)] bg-white/95 backdrop-blur safe-bottom">
        <div className="mx-auto flex max-w-md items-center gap-3 p-3">
          <div className="min-w-[88px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--kart-muted)]">Total</p>
            <p className="text-lg font-extrabold leading-tight tabular-nums">{peso(totals.total)}</p>
          </div>
          <button type="button" onClick={submit} disabled={submitting || expired} className="k-btn k-btn-primary flex-1 flex-col !gap-0 text-[15px]" aria-busy={submitting}>
            <span className="flex items-center gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {expired ? "Hold ended" : submitting ? "Placing order…" : method === "cod" ? "Place order" : "Confirm & pay"}
            </span>
            {!expired && !submitting && <span className="text-[11px] font-medium opacity-90">Delivered by BayanGo</span>}
          </button>
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
