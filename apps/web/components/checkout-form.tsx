"use client";

import { GiftCardInput, type AppliedGiftCard } from "@/components/gift-card-input";
import { storedUtm } from "@/components/storefront/attribution-capture";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cartLineKey, useCart } from "@/lib/cart";
import { GumaIdSignIn } from "@/components/guma-id/sign-in";
import { maskPhone, useGumaId } from "@/components/guma-id/use-guma-id";
import type { StorefrontStoreSettings } from "@/lib/storefront-settings";
import {
  computeDeliveryFee,
  deliveryProviderLabel,
} from "@/lib/storefront-settings";
import {
  computeCheckoutTotals,
  isPaymentMethodEnabled,
} from "@gumakart/db/checkout";
import {
  PhAddressFields,
  composePhDeliveryAddress,
  type PhAddressValue,
} from "@/components/ph-address-fields";

const ALL_PAYMENT_METHODS = [
  { id: "gcash", label: "GCash", icon: "💙", desc: "Send to shop GCash" },
  { id: "paymaya", label: "Maya", icon: "💚", desc: "Send to shop Maya" },
  { id: "bank", label: "Bank transfer", icon: "🏦", desc: "Direct bank deposit" },
  { id: "qrph", label: "QR Ph", icon: "📱", desc: "Scan to pay (PayMongo)" },
  { id: "cod", label: "Cash on Delivery", icon: "💵", desc: "Pay rider on arrival" },
  { id: "card", label: "Card", icon: "💳", desc: "Visa / Mastercard (PayMongo)" },
];

const PH_MOBILE = /^(09\d{9}|\+639\d{9})$/;

function checkoutSessionKey(tenantSlug: string): string {
  if (typeof window === "undefined") return "";
  const key = `guma-checkout-session:${tenantSlug}`;
  const existing = window.localStorage.getItem(key);
  if (existing && existing.length >= 8) return existing;
  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 32)
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, next);
  return next;
}

function formatPrice(amount: number, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function CheckoutForm({
  tenantSlug,
  storeSettings,
}: {
  tenantSlug: string;
  storeSettings: StorefrontStoreSettings;
}) {
  const cart = useCart(tenantSlug);
  const checkout = storeSettings.checkout;

  const paymentMethods = useMemo(
    () =>
      ALL_PAYMENT_METHODS.filter((method) =>
        isPaymentMethodEnabled(checkout, method.id)
      ),
    [checkout]
  );

  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [payment, setPayment] = useState(paymentMethods[0]?.id ?? "gcash");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [email, setEmail] = useState("");
  const [phAddress, setPhAddress] = useState<PhAddressValue>({
    street1: "",
    street2: "",
    barangay: "",
    city: "",
    province: "",
    provinceCode: "",
    cityCode: "",
  });
  const [couponCode, setCouponCode] = useState("");
  const [giftCard, setGiftCard] = useState<AppliedGiftCard | null>(null);
  // Phase 12: Guma ID pre-fill.
  const gid = useGumaId();
  const [gidOpen, setGidOpen] = useState(false);
  const [gidFilled, setGidFilled] = useState(false);
  useEffect(() => {
    if (!gid.buyer || gidFilled) return;
    setGidFilled(true);
    const b = gid.buyer;
    setName((n) => n || b.name || "");
    setPhone(b.phone);
    if (b.email) setEmail((e) => e || b.email || "");
    const def = gid.addresses.find((a) => a.isDefault) ?? gid.addresses[0];
    if (def) {
      setPhAddress((cur) =>
        cur.street1
          ? cur
          : {
              street1: def.address.line1 ?? "",
              street2: def.address.landmark ? `Landmark: ${def.address.landmark}` : "",
              barangay: def.address.barangay ?? "",
              city: def.address.city ?? "",
              province: def.address.province ?? "",
              provinceCode: def.address.provinceCode ?? "",
              cityCode: def.address.cityCode ?? "",
            }
      );
    }
    if (b.preferredPayment && paymentMethods.some((m) => m.id === b.preferredPayment)) setPayment(b.preferredPayment);
  }, [gid.buyer, gid.addresses, gidFilled, paymentMethods]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [liveQuote, setLiveQuote] = useState<{ fee: number; etaMinutes: number | null } | null>(
    null
  );
  const [quoting, setQuoting] = useState(false);
  const [sessionKey, setSessionKey] = useState("");

  const composedAddress = composePhDeliveryAddress(phAddress);
  const { city, barangay, province, street1, street2 } = phAddress;

  useEffect(() => {
    setSessionKey(checkoutSessionKey(tenantSlug));
  }, [tenantSlug]);

  useEffect(() => {
    if (paymentMethods.length && !paymentMethods.some((m) => m.id === payment)) {
      setPayment(paymentMethods[0]!.id);
    }
  }, [paymentMethods, payment]);

  // Live Lalamove quote once the customer has typed a usable address.
  const wantsLiveQuote =
    (storeSettings.delivery.provider === "lalamove" ||
      storeSettings.delivery.provider === "grab") &&
    fulfillment === "delivery" &&
    street1.trim().length >= 5 &&
    Boolean(city.trim() && barangay.trim() && province.trim());
  const quoteAddress = wantsLiveQuote ? composedAddress : "";

  useEffect(() => {
    if (!quoteAddress) {
      setLiveQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/delivery/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantSlug, address: quoteAddress }),
        });
        const data = await res.json();
        if (!cancelled) {
          setLiveQuote(
            res.ok && data.live ? { fee: data.fee, etaMinutes: data.etaMinutes } : null
          );
        }
      } catch {
        if (!cancelled) setLiveQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [quoteAddress, tenantSlug]);

  // Sync cart progress for abandoned-checkout detection.
  useEffect(() => {
    if (!sessionKey || !cart.ready || cart.items.length === 0) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          sessionKey,
          cart: cart.items,
          customer: { name, phone, email },
          address: {
            line1: street1,
            line2: street2 || undefined,
            city,
            barangay,
            province,
          },
          couponCode: couponCode || null,
          smsConsent,
        }),
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    sessionKey,
    cart.ready,
    cart.items,
    tenantSlug,
    name,
    phone,
    smsConsent,
    email,
    street1,
    street2,
    city,
    barangay,
    province,
    couponCode,
  ]);

  const subtotal = cart.subtotal;
  const deliveryFee =
    fulfillment === "pickup"
      ? 0
      : liveQuote?.fee ??
        computeDeliveryFee(subtotal, storeSettings, { city, barangay, province });
  const totals = computeCheckoutTotals({
    subtotal,
    deliveryFee,
    checkout,
    couponCode,
    // Phase 14: quantity deals need the lines (the server recomputes the same way).
    lines: cart.items.map((i) => ({ productId: i.productId, quantity: i.qty, lineTotal: i.price * i.qty })),
  });
  // Phase 17: gift card / store credit pays first; the rest is due by the chosen method.
  const giftApplied = giftCard ? Math.min(giftCard.balance, totals.total) : 0;
  const amountDue = Math.max(0, Math.round((totals.total - giftApplied) * 100) / 100);
  const belowMinimum = subtotal > 0 && subtotal < storeSettings.minOrderAmount;

  const cleanPhone = phone.replace(/[\s-]/g, "");
  const fieldErrors = {
    name: name.trim().length < 2 ? "Enter your full name." : null,
    phone: !PH_MOBILE.test(cleanPhone)
      ? "Enter a valid PH mobile number (09XX XXX XXXX)."
      : null,
    email:
      checkout.customer?.requireEmail && !email.trim()
        ? "Email is required."
        : email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          ? "Enter a valid email."
          : null,
    street1:
      fulfillment === "delivery" && street1.trim().length < 5
        ? "Enter your street / building address."
        : null,
    province:
      fulfillment === "delivery" && !province.trim()
        ? "Select or type your province."
        : null,
    city: fulfillment === "delivery" && !city.trim() ? "Select or type your city / town." : null,
    barangay:
      fulfillment === "delivery" && !barangay.trim() ? "Select or type your barangay." : null,
  };
  const hasFieldErrors = Boolean(
    fieldErrors.name ||
      fieldErrors.phone ||
      fieldErrors.email ||
      fieldErrors.street1 ||
      fieldErrors.province ||
      fieldErrors.city ||
      fieldErrors.barangay
  );

  async function handleCheckout() {
    setTouched(true);
    setError(null);
    if (belowMinimum || cart.items.length === 0 || hasFieldErrors) return;

    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          paymentMethod: payment,
          fulfillment,
          sessionKey: sessionKey || undefined,
          couponCode: couponCode.trim() || undefined,
          giftCardCode: giftCard?.code,
          smsConsent,
          utm: storedUtm(tenantSlug),
          customer: {
            name: name.trim(),
            phone: cleanPhone,
            email: email.trim() || undefined,
          },
          address: fulfillment === "delivery" ? composedAddress : undefined,
          street1: fulfillment === "delivery" ? street1.trim() : undefined,
          street2: fulfillment === "delivery" ? street2.trim() || undefined : undefined,
          city: fulfillment === "delivery" ? city.trim() || undefined : undefined,
          barangay: fulfillment === "delivery" ? barangay.trim() || undefined : undefined,
          province: fulfillment === "delivery" ? province.trim() || undefined : undefined,
          notes: notes.trim() || undefined,
          items: cart.items.map((item) => ({ productId: item.productId, variantId: item.variantId ?? null, qty: item.qty })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Checkout failed. Please try again.");
        return;
      }

      cart.clear();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else if (data.orderUrl) {
        window.location.href = data.orderUrl;
      } else if (data.orderNumber) {
        // Demo shops only — real orders always come back with a tokenized orderUrl.
        window.location.href = `/${tenantSlug}/orders/${data.orderNumber}`;
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const placeOrderLabel = loading
    ? "Processing…"
    : payment === "cod"
      ? "Place Order"
      : "Place Order & Pay";
  const canPlaceOrder = !loading && !belowMinimum && cart.ready && cart.items.length > 0;
  const deliveryFeeLabel =
    fulfillment !== "delivery"
      ? null
      : liveQuote
        ? liveQuote.etaMinutes
          ? `${deliveryProviderLabel(storeSettings.delivery.provider)} · ~${liveQuote.etaMinutes} min`
          : `${deliveryProviderLabel(storeSettings.delivery.provider)} · live quote`
        : quoting
          ? `${deliveryProviderLabel(storeSettings.delivery.provider)} · quoting…`
          : totals.deliveryFee === 0 && storeSettings.delivery.freeDeliveryMin > 0
            ? `${deliveryProviderLabel(storeSettings.delivery.provider)} (free)`
            : deliveryProviderLabel(storeSettings.delivery.provider);

  const summaryBlock = (
    <div className="space-y-3 text-sm">
      <div className="flex justify-between gap-4">
        <span className="text-stone-500">
          Merchandise Subtotal ({cart.count} item{cart.count === 1 ? "" : "s"})
        </span>
        <span className="font-medium text-stone-900">
          {formatPrice(totals.subtotal, storeSettings.currency)}
        </span>
      </div>
      {totals.discount > 0 && (
        <div className="flex justify-between gap-4 text-emerald-700">
          <span>{totals.discountLabel ?? "Shop Voucher"}</span>
          <span>-{formatPrice(totals.discount, storeSettings.currency)}</span>
        </div>
      )}
      {totals.tax > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">
            Tax{checkout.tax?.inclusive ? " (included)" : ""}
          </span>
          <span className="font-medium text-stone-900">
            {formatPrice(totals.tax, storeSettings.currency)}
          </span>
        </div>
      )}
      {fulfillment === "delivery" && (
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">{deliveryFeeLabel}</span>
          <span className="font-medium text-stone-900">
            {formatPrice(totals.deliveryFee, storeSettings.currency)}
          </span>
        </div>
      )}
      {fulfillment === "pickup" && (
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">Shipping Fee</span>
          <span className="font-medium text-emerald-700">FREE (Pickup)</span>
        </div>
      )}
      {giftApplied > 0 && (
        <>
          <div className="flex justify-between gap-4 border-t border-stone-200 pt-2">
            <span className="text-stone-500">Order total</span>
            <span className="font-medium">{formatPrice(totals.total, storeSettings.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-emerald-700" data-testid="summary-giftcard">
            <span>{giftCard?.kind === "store_credit" ? "Store credit" : "Gift card"}</span>
            <span>-{formatPrice(giftApplied, storeSettings.currency)}</span>
          </div>
        </>
      )}
      <div className="flex items-end justify-between gap-4 border-t border-stone-200 pt-3">
        <span className="text-sm font-semibold text-stone-800">{giftApplied > 0 ? "Babayaran" : "Total Payment"}</span>
        <span className="text-xl font-bold tracking-tight text-[#ee4d2d]" data-testid="summary-due">
          {formatPrice(amountDue, storeSettings.currency)}
        </span>
      </div>
      {giftApplied > 0 && amountDue === 0 && <p className="text-xs text-emerald-700">Bayad na lahat gamit ang card — walang babayaran pa.</p>}
      {storeSettings.minOrderAmount > 0 && (
        <p className="text-xs text-stone-500">
          Minimum order: {formatPrice(storeSettings.minOrderAmount, storeSettings.currency)}
        </p>
      )}
    </div>
  );

  if (cart.ready && cart.items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f5f5] p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
          <ShoppingBag className="h-7 w-7 text-[#ee4d2d]" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-stone-900">Your cart is empty</h1>
        <p className="mt-2 max-w-xs text-sm text-stone-500">
          Browse the shop and tap “Add to Cart” on the products you want.
        </p>
        <Link href={`/${tenantSlug}`} className="mt-6">
          <Button
            size="lg"
            className="gap-2 bg-[#ee4d2d] text-white hover:bg-[#d73211]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to shop
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] pb-28 lg:pb-10">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link
            href={`/${tenantSlug}`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-50"
            aria-label="Back to shop"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight text-stone-900">Checkout</h1>
            <p className="flex items-center gap-1 text-xs text-stone-500">
              <Lock className="h-3 w-3" />
              Guest checkout · Secure payment
            </p>
          </div>
          <div className="hidden text-right text-xs text-stone-500 sm:block">
            <p className="font-semibold text-stone-800">{cart.count} item{cart.count === 1 ? "" : "s"}</p>
            <p className="font-bold text-[#ee4d2d]">
              {formatPrice(amountDue, storeSettings.currency)}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 px-3 py-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-5 lg:px-4">
        <div className="space-y-3">
          {storeSettings.delivery.deliveryNotes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {storeSettings.delivery.deliveryNotes}
            </div>
          )}

          {/* Products */}
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ee4d2d] text-[11px] font-bold text-white">
                1
              </span>
              <h2 className="text-sm font-bold text-stone-900">
                Products Ordered
                <span className="ml-1.5 font-normal text-stone-500">
                  ({cart.count} item{cart.count === 1 ? "" : "s"})
                </span>
              </h2>
            </div>
            <ul className="divide-y divide-stone-100">
              {cart.items.map((item) => (
                <li key={cartLineKey(item)} className="flex items-center gap-3 px-4 py-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-stone-100 bg-stone-50">
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.title}
                        fill
                        className="object-cover"
                        sizes="64px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-stone-300">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-stone-900">{item.title}</p>
                    {item.variantTitle ? <p className="text-xs text-stone-500">{item.variantTitle}</p> : null}
                    <p className="mt-0.5 text-sm font-bold text-[#ee4d2d]">
                      {formatPrice(item.price, storeSettings.currency)}
                    </p>
                  </div>
                  <div className="flex items-center rounded-md border border-stone-200 bg-stone-50">
                    <button
                      type="button"
                      aria-label={`Decrease ${item.title} quantity`}
                      onClick={() => cart.setQty(cartLineKey(item), item.qty - 1)}
                      className="flex h-8 w-8 items-center justify-center text-stone-600 hover:bg-stone-100"
                    >
                      {item.qty === 1 ? (
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      ) : (
                        <Minus className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-stone-900">
                      {item.qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${item.title} quantity`}
                      onClick={() => cart.setQty(cartLineKey(item), item.qty + 1)}
                      className="flex h-8 w-8 items-center justify-center text-stone-600 hover:bg-stone-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Fulfillment */}
          {storeSettings.delivery.pickupEnabled && (
            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ee4d2d] text-[11px] font-bold text-white">
                  2
                </span>
                <h2 className="text-sm font-bold text-stone-900">Delivery Option</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setFulfillment("delivery")}
                  className={`relative rounded-lg border-2 p-3 text-left transition ${
                    fulfillment === "delivery"
                      ? "border-[#ee4d2d] bg-orange-50"
                      : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  {fulfillment === "delivery" && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee4d2d]">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                  <MapPin
                    className={`h-5 w-5 ${fulfillment === "delivery" ? "text-[#ee4d2d]" : "text-stone-400"}`}
                  />
                  <p className="mt-2 text-sm font-bold text-stone-900">Delivery</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">Ship to your address</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFulfillment("pickup")}
                  className={`relative rounded-lg border-2 p-3 text-left transition ${
                    fulfillment === "pickup"
                      ? "border-[#ee4d2d] bg-orange-50"
                      : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  {fulfillment === "pickup" && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee4d2d]">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                  <Store
                    className={`h-5 w-5 ${fulfillment === "pickup" ? "text-[#ee4d2d]" : "text-stone-400"}`}
                  />
                  <p className="mt-2 text-sm font-bold text-stone-900">Store Pickup</p>
                  <p className="mt-0.5 text-[11px] font-medium text-emerald-700">No shipping fee</p>
                </button>
              </div>
            </section>
          )}

          {/* Contact + address */}
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ee4d2d] text-[11px] font-bold text-white">
                {storeSettings.delivery.pickupEnabled ? "3" : "2"}
              </span>
              <h2 className="text-sm font-bold text-stone-900">
                {fulfillment === "pickup" ? "Pickup Details" : "Delivery Address"}
              </h2>
            </div>
            <div className="space-y-3 p-4">
              {gid.available && !gid.buyer && (
                <div className="rounded-lg border border-dashed border-stone-300 p-3 text-sm" data-testid="guma-id-bar">
                  {!gidOpen ? (
                    <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setGidOpen(true)}>
                      <span>⚡ <strong>May Guma ID ka?</strong> <span className="text-stone-500">Auto-fill ang detalye mo.</span></span>
                      <span className="font-semibold text-[#ee4d2d] underline">Sign in</span>
                    </button>
                  ) : (
                    <GumaIdSignIn compact accent="#ee4d2d" defaultPhone={phone} onSignedIn={() => gid.refresh()} />
                  )}
                </div>
              )}
              {gid.buyer && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ Guma ID: {maskPhone(gid.buyer.phone)} — na-fill na ang detalye mo.</p>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-600">Full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    placeholder="Juan Dela Cruz"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    className="h-11 w-full rounded-md border border-orange-300 bg-orange-50 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30"
                  />
                </div>
                {touched && fieldErrors.name && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-600">
                  Phone number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    placeholder="09XX XXX XXXX"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    className="h-11 w-full rounded-md border border-orange-300 bg-orange-50 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30"
                  />
                </div>
                {touched && fieldErrors.phone && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
                )}
                <p className="mt-1 text-xs text-stone-500">
                  For order updates and delivery tracking via SMS.
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs text-stone-600">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={(event) => setSmsConsent(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-orange-600"
                  />
                  <span>
                    Text me reminders about this order (e.g. if I don&apos;t finish paying). Every
                    reminder has a link to stop them. Order updates are always sent.
                  </span>
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-600">
                  Email{checkout.customer?.requireEmail ? "" : " (optional)"}
                </label>
                <input
                  placeholder="you@email.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  className="h-11 w-full rounded-md border border-orange-300 bg-orange-50 px-3 text-sm text-stone-900 placeholder:text-stone-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30"
                />
                {touched && fieldErrors.email && (
                  <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
                )}
              </div>
              {fulfillment === "delivery" ? (
                <PhAddressFields
                  value={phAddress}
                  onChange={setPhAddress}
                  showErrors={touched}
                  errors={{
                    street1: fieldErrors.street1,
                    province: fieldErrors.province,
                    city: fieldErrors.city,
                    barangay: fieldErrors.barangay,
                  }}
                />
              ) : (
                <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-600">
                  We&apos;ll text you when your order is ready for pickup at the store.
                </p>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-600">
                  Notes / landmark (optional)
                </label>
                <input
                  placeholder="e.g. Near barangay hall, blue gate"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="h-11 w-full rounded-md border border-orange-300 bg-orange-50 px-3 text-sm text-stone-900 placeholder:text-stone-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30"
                />
              </div>
            </div>
          </section>

          {/* Payment */}
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ee4d2d] text-[11px] font-bold text-white">
                {storeSettings.delivery.pickupEnabled ? "4" : "3"}
              </span>
              <h2 className="text-sm font-bold text-stone-900">Payment Method</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              {paymentMethods.map((m) => {
                const selected = payment === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayment(m.id)}
                    className={`relative flex items-center gap-3 rounded-lg border-2 px-3 py-3 text-left transition ${
                      selected
                        ? "border-[#ee4d2d] bg-orange-50"
                        : "border-stone-200 bg-white hover:border-stone-300"
                    }`}
                  >
                    <span className="text-xl leading-none" aria-hidden>
                      {m.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-stone-900">{m.label}</span>
                      <span className="block text-[11px] text-stone-500">{m.desc}</span>
                    </span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected
                          ? "border-[#ee4d2d] bg-[#ee4d2d]"
                          : "border-stone-300 bg-white"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Voucher */}
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 px-4 py-3">
              <Tag className="h-4 w-4 text-[#ee4d2d]" />
              <h2 className="text-sm font-bold text-stone-900">Shop Voucher</h2>
            </div>
            <div className="border-t border-stone-100 px-4 py-3">
              <div className="flex gap-2">
                <input
                  placeholder="Enter voucher / coupon code"
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  className="h-11 min-w-0 flex-1 rounded-md border border-orange-300 bg-orange-50 px-3 text-sm font-semibold tracking-wide text-stone-900 placeholder:font-normal placeholder:tracking-normal placeholder:text-stone-500 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-400/30"
                />
                {totals.couponCode && (
                  <span className="inline-flex h-11 items-center rounded-md bg-emerald-50 px-3 text-xs font-bold text-emerald-700">
                    Applied
                  </span>
                )}
              </div>
              <div className="mt-3">
                <GiftCardInput tenantSlug={tenantSlug} value={giftCard} onChange={setGiftCard} />
              </div>
            </div>
          </section>

          {/* Mobile-only summary (desktop uses sticky sidebar) */}
          <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm lg:hidden">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-bold text-stone-900">Payment Details</h2>
            </div>
            <div className="px-4 py-3">{summaryBlock}</div>
          </section>

          {belowMinimum && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Minimum order is {formatPrice(storeSettings.minOrderAmount, storeSettings.currency)}.
              Add more items to place your order.
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        {/* Desktop sticky summary */}
        <aside className="hidden lg:block">
          <div className="sticky top-[4.5rem] space-y-3">
            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-bold text-stone-900">Order Summary</h2>
              </div>
              <div className="px-4 py-3">{summaryBlock}</div>
              <div className="border-t border-stone-100 p-4">
                <Button
                  className="h-12 w-full gap-2 bg-[#ee4d2d] text-base font-bold text-white hover:bg-[#d73211] disabled:opacity-60"
                  size="lg"
                  onClick={handleCheckout}
                  disabled={!canPlaceOrder}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    placeOrderLabel
                  )}
                </Button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-stone-500">
                  <Lock className="h-3 w-3" />
                  Secure checkout · SMS confirmation
                </p>
              </div>
            </section>
          </div>
        </aside>
      </div>

      {/* Mobile sticky place-order bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 px-3 py-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-stone-500">{giftApplied > 0 ? "Babayaran" : "Total Payment"}</p>
            <p className="truncate text-lg font-bold leading-tight text-[#ee4d2d]">
              {formatPrice(amountDue, storeSettings.currency)}
            </p>
          </div>
          <Button
            className="h-12 min-w-[9.5rem] shrink-0 gap-2 bg-[#ee4d2d] px-5 text-sm font-bold text-white hover:bg-[#d73211] disabled:opacity-60"
            size="lg"
            onClick={handleCheckout}
            disabled={!canPlaceOrder}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                …
              </>
            ) : (
              placeOrderLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
