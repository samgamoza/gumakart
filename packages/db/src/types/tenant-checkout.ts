/**
 * Tenant checkout configuration — draft and published share the same shape.
 * Storefront reads checkout_published_json (with settings_json fallback).
 */
export interface CheckoutCoupon {
  code: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotal?: number;
  maxRedemptions?: number;
  active?: boolean;
  /** Phase 14: valid from / until (ISO). Outside the window the code doesn't apply. */
  startsAt?: string;
  endsAt?: string;
  /** One use per buyer mobile number. */
  oncePerBuyer?: boolean;
  /** Seller-only note, e.g. "Payday sale — FB post". */
  note?: string;
}

/**
 * Phase 14: "Buy N or more, get X off" — applies by itself (no code) to the matching items.
 * percent = % off those lines; fixed = ₱ off each matching item.
 */
export interface CheckoutVolumeDiscount {
  id: string;
  label: string;
  /** Empty = any product. */
  productIds: string[];
  minQty: number;
  type: "percent" | "fixed";
  value: number;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
}

export interface CheckoutLineForDiscount {
  productId: string;
  quantity: number;
  /** Price × quantity for this line (pesos). */
  lineTotal: number;
}

export interface CheckoutTaxConfig {
  enabled?: boolean;
  /** VAT / sales tax percent, e.g. 12 for 12% */
  ratePercent?: number;
  /** When true, catalog prices already include tax */
  inclusive?: boolean;
}

export interface CheckoutAutomaticDiscount {
  type: "percent" | "fixed";
  value: number;
  minSubtotal?: number;
  label?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface CheckoutPaymentAdapters {
  cod?: boolean;
  /** Direct GCash/Maya/bank (seller confirms) — MVP/beta bridge without PayMongo */
  manual_ewallet?: {
    gcash?: boolean;
    maya?: boolean;
    bank?: boolean;
  };
  paymongo?: {
    gcash?: boolean;
    paymaya?: boolean;
    qrph?: boolean;
    card?: boolean;
  };
}

export interface CheckoutCustomerRequirements {
  requireEmail?: boolean;
  /** Collect city / barangay / postal in addition to line1 */
  requireStructuredAddress?: boolean;
}

export interface TenantCheckoutJson {
  codEnabled?: boolean;
  minOrderAmount?: number;
  autoAcceptOrders?: boolean;
  tax?: CheckoutTaxConfig;
  coupons?: CheckoutCoupon[];
  automaticDiscount?: CheckoutAutomaticDiscount | null;
  /** Phase 14: quantity / bundle deals. */
  volumeDiscounts?: CheckoutVolumeDiscount[];
  paymentAdapters?: CheckoutPaymentAdapters;
  customer?: CheckoutCustomerRequirements;
  /** Minutes of inactivity before a checkout session is marked abandoned */
  abandonedAfterMinutes?: number;
  rationale?: string;
}

export const EMPTY_CHECKOUT: TenantCheckoutJson = {
  codEnabled: true,
  minOrderAmount: 99,
  autoAcceptOrders: false,
  tax: { enabled: false, ratePercent: 12, inclusive: false },
  coupons: [],
  automaticDiscount: null,
  paymentAdapters: {
    cod: true,
    // Beta default: direct e-wallet until PayMongo API is secured
    manual_ewallet: { gcash: true, maya: true, bank: false },
    paymongo: { gcash: false, paymaya: false, qrph: false, card: false },
  },
  customer: { requireEmail: false, requireStructuredAddress: false },
  abandonedAfterMinutes: 60,
};

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCoupon(raw: unknown): CheckoutCoupon | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const code = typeof c.code === "string" ? c.code.trim().toUpperCase() : "";
  if (!code) return null;
  const type = c.type === "fixed" ? "fixed" : "percent";
  const value = asNumber(c.value, 0);
  if (value <= 0) return null;
  return {
    code,
    type,
    value,
    minSubtotal: c.minSubtotal != null ? asNumber(c.minSubtotal, 0) : undefined,
    maxRedemptions: c.maxRedemptions != null ? asNumber(c.maxRedemptions, 0) : undefined,
    active: c.active !== false,
    startsAt: isoOrUndefined(c.startsAt),
    endsAt: isoOrUndefined(c.endsAt),
    oncePerBuyer: c.oncePerBuyer === true ? true : undefined,
    note: typeof c.note === "string" && c.note.trim() ? c.note.trim().slice(0, 120) : undefined,
  };
}

function isoOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Inside [startsAt, endsAt) — open ends allowed. */
export function inDiscountWindow(d: { startsAt?: string; endsAt?: string }, now: Date = new Date()): boolean {
  const t = now.getTime();
  if (d.startsAt && Date.parse(d.startsAt) > t) return false;
  if (d.endsAt && Date.parse(d.endsAt) <= t) return false;
  return true;
}

function normalizeVolume(raw: unknown, index: number): CheckoutVolumeDiscount | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const minQty = Math.trunc(asNumber(v.minQty, 0));
  const value = asNumber(v.value, 0);
  const type = v.type === "fixed" ? "fixed" : "percent";
  if (minQty < 2 || value <= 0 || (type === "percent" && value > 100)) return null;
  return {
    id: typeof v.id === "string" && v.id ? v.id.slice(0, 40) : `deal-${index + 1}`,
    label: typeof v.label === "string" && v.label.trim() ? v.label.trim().slice(0, 60) : `Buy ${minQty}+`,
    productIds: Array.isArray(v.productIds) ? v.productIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [],
    minQty,
    type,
    value,
    active: v.active !== false,
    startsAt: isoOrUndefined(v.startsAt),
    endsAt: isoOrUndefined(v.endsAt),
  };
}

export function normalizeCheckoutJson(input: unknown): TenantCheckoutJson {
  if (!input || typeof input !== "object") return { ...EMPTY_CHECKOUT };
  const raw = input as Record<string, unknown>;
  const tax =
    raw.tax && typeof raw.tax === "object"
      ? (raw.tax as CheckoutTaxConfig)
      : EMPTY_CHECKOUT.tax;
  const adapters =
    raw.paymentAdapters && typeof raw.paymentAdapters === "object"
      ? (raw.paymentAdapters as CheckoutPaymentAdapters)
      : EMPTY_CHECKOUT.paymentAdapters;
  const customer =
    raw.customer && typeof raw.customer === "object"
      ? (raw.customer as CheckoutCustomerRequirements)
      : EMPTY_CHECKOUT.customer;
  const auto =
    raw.automaticDiscount && typeof raw.automaticDiscount === "object"
      ? (raw.automaticDiscount as CheckoutAutomaticDiscount)
      : null;

  const coupons = Array.isArray(raw.coupons)
    ? raw.coupons.map(normalizeCoupon).filter((c): c is CheckoutCoupon => !!c)
    : [];

  return {
    codEnabled: raw.codEnabled !== false,
    minOrderAmount: asNumber(raw.minOrderAmount, EMPTY_CHECKOUT.minOrderAmount!),
    autoAcceptOrders: raw.autoAcceptOrders === true,
    tax: {
      enabled: tax?.enabled === true,
      ratePercent: asNumber(tax?.ratePercent, 12),
      inclusive: tax?.inclusive === true,
    },
    coupons,
    automaticDiscount:
      auto && asNumber(auto.value, 0) > 0
        ? {
            type: auto.type === "fixed" ? "fixed" : "percent",
            value: asNumber(auto.value, 0),
            minSubtotal: auto.minSubtotal != null ? asNumber(auto.minSubtotal, 0) : undefined,
            label: typeof auto.label === "string" ? auto.label : undefined,
            startsAt: isoOrUndefined((auto as { startsAt?: unknown }).startsAt),
            endsAt: isoOrUndefined((auto as { endsAt?: unknown }).endsAt),
          }
        : null,
    volumeDiscounts: Array.isArray(raw.volumeDiscounts)
      ? raw.volumeDiscounts.map(normalizeVolume).filter((d): d is CheckoutVolumeDiscount => !!d).slice(0, 20)
      : [],
    paymentAdapters: {
      cod: adapters?.cod !== false,
      manual_ewallet: {
        gcash: adapters?.manual_ewallet?.gcash !== false,
        maya: adapters?.manual_ewallet?.maya !== false,
        bank: adapters?.manual_ewallet?.bank === true,
      },
      paymongo: {
        gcash: adapters?.paymongo?.gcash === true,
        paymaya: adapters?.paymongo?.paymaya === true,
        qrph: adapters?.paymongo?.qrph === true,
        card: adapters?.paymongo?.card === true,
      },
    },
    customer: {
      requireEmail: customer?.requireEmail === true,
      requireStructuredAddress: customer?.requireStructuredAddress === true,
    },
    abandonedAfterMinutes: Math.max(
      15,
      asNumber(raw.abandonedAfterMinutes, EMPTY_CHECKOUT.abandonedAfterMinutes!)
    ),
    rationale: typeof raw.rationale === "string" ? raw.rationale : undefined,
  };
}

/** Seed checkout config from legacy settings_json fields. */
export function checkoutFromLegacySettings(settings: {
  codEnabled?: boolean;
  minOrderAmount?: number;
  autoAcceptOrders?: boolean;
} | null | undefined): TenantCheckoutJson {
  return normalizeCheckoutJson({
    ...EMPTY_CHECKOUT,
    codEnabled: settings?.codEnabled ?? true,
    minOrderAmount: settings?.minOrderAmount ?? 99,
    autoAcceptOrders: settings?.autoAcceptOrders ?? false,
  });
}

export function findActiveCoupon(
  checkout: TenantCheckoutJson,
  code: string | null | undefined,
  now: Date = new Date()
): CheckoutCoupon | null {
  if (!code?.trim()) return null;
  const normalized = code.trim().toUpperCase();
  return (
    checkout.coupons?.find((c) => c.active !== false && c.code === normalized && inDiscountWindow(c, now)) ?? null
  );
}

/**
 * Phase 14: quantity deals. Each line gets at most one deal (the best for it); a deal needs
 * its minimum quantity across all its matching lines. Returns ₱ off and the deal labels used.
 */
export function computeVolumeDiscount(
  deals: CheckoutVolumeDiscount[] | undefined,
  lines: CheckoutLineForDiscount[] | undefined,
  now: Date = new Date()
): { amount: number; labels: string[] } {
  if (!deals?.length || !lines?.length) return { amount: 0, labels: [] };
  const live = deals.filter((d) => d.active !== false && inDiscountWindow(d, now));
  const eligible = live.filter((d) => {
    const qty = lines.filter((l) => d.productIds.length === 0 || d.productIds.includes(l.productId)).reduce((n, l) => n + l.quantity, 0);
    return qty >= d.minQty;
  });
  let amount = 0;
  const used = new Set<string>();
  for (const line of lines) {
    let best = 0;
    let bestLabel: string | null = null;
    for (const d of eligible) {
      if (d.productIds.length && !d.productIds.includes(line.productId)) continue;
      const off = Math.min(line.lineTotal, d.type === "percent" ? (line.lineTotal * d.value) / 100 : d.value * line.quantity);
      if (off > best) {
        best = off;
        bestLabel = d.label;
      }
    }
    amount += best;
    if (bestLabel) used.add(bestLabel);
  }
  return { amount: Math.round(amount * 100) / 100, labels: [...used] };
}

export interface CheckoutTotalsInput {
  subtotal: number;
  deliveryFee: number;
  checkout: TenantCheckoutJson;
  couponCode?: string | null;
  /** Phase 14: the cart lines, so quantity deals can apply. */
  lines?: CheckoutLineForDiscount[];
  now?: Date;
}

export interface CheckoutTotals {
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee: number;
  total: number;
  couponCode: string | null;
  discountLabel: string | null;
}

/** Pure totals math used by createOrder and storefront preview. */
export function computeCheckoutTotals(input: CheckoutTotalsInput): CheckoutTotals {
  const subtotal = Math.max(0, input.subtotal);
  const now = input.now ?? new Date();
  let discount = 0;
  let discountLabel: string | null = null;
  let couponCode: string | null = null;

  // Quantity deals first (on the items), then one order discount on what's left.
  const volume = computeVolumeDiscount(input.checkout.volumeDiscounts, input.lines, now);
  const afterVolume = Math.max(0, subtotal - volume.amount);
  const labels: string[] = [...volume.labels];

  const coupon = findActiveCoupon(input.checkout, input.couponCode, now);
  if (coupon) {
    const min = coupon.minSubtotal ?? 0;
    if (subtotal >= min) {
      discount =
        coupon.type === "percent"
          ? (afterVolume * coupon.value) / 100
          : coupon.value;
      labels.push(`Coupon ${coupon.code}`);
      couponCode = coupon.code;
    }
  } else if (input.checkout.automaticDiscount && inDiscountWindow(input.checkout.automaticDiscount, now)) {
    const auto = input.checkout.automaticDiscount;
    const min = auto.minSubtotal ?? 0;
    if (subtotal >= min) {
      discount =
        auto.type === "percent" ? (afterVolume * auto.value) / 100 : auto.value;
      labels.push(auto.label ?? "Automatic discount");
    }
  }
  discount = Math.min(discount, afterVolume) + volume.amount;
  discountLabel = labels.length ? labels.join(" + ") : null;

  discount = Math.min(discount, subtotal);
  const afterDiscount = subtotal - discount;

  const taxCfg = input.checkout.tax;
  let tax = 0;
  if (taxCfg?.enabled && (taxCfg.ratePercent ?? 0) > 0) {
    const rate = (taxCfg.ratePercent ?? 0) / 100;
    if (taxCfg.inclusive) {
      tax = afterDiscount - afterDiscount / (1 + rate);
    } else {
      tax = afterDiscount * rate;
    }
  }

  const deliveryFee = Math.max(0, input.deliveryFee);
  const taxableBase = taxCfg?.inclusive ? afterDiscount : afterDiscount + tax;
  const total = Math.max(0, taxableBase + deliveryFee);

  return {
    subtotal: roundMoney(subtotal),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    deliveryFee: roundMoney(deliveryFee),
    total: roundMoney(total),
    couponCode,
    discountLabel,
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isPaymentMethodEnabled(
  checkout: TenantCheckoutJson,
  method: string
): boolean {
  if (method === "cod") {
    return checkout.paymentAdapters?.cod !== false && checkout.codEnabled !== false;
  }

  const manual = checkout.paymentAdapters?.manual_ewallet;
  const pm = checkout.paymentAdapters?.paymongo;

  if (method === "gcash") {
    return manual?.gcash !== false || pm?.gcash === true;
  }
  if (method === "paymaya") {
    return manual?.maya !== false || pm?.paymaya === true;
  }
  if (method === "bank") {
    return manual?.bank === true;
  }
  if (method === "qrph") return pm?.qrph === true;
  if (method === "card") return pm?.card === true;
  return false;
}

/**
 * Phase 17 — the promos that apply without a code (quantity deals, then the automatic
 * discount on what's left), for the POS register. Same math as computeCheckoutTotals.
 */
export function computeStorePromotion(
  checkout: Pick<TenantCheckoutJson, "volumeDiscounts" | "automaticDiscount">,
  lines: CheckoutLineForDiscount[],
  now: Date = new Date()
): { amount: number; labels: string[] } {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const volume = computeVolumeDiscount(checkout.volumeDiscounts, lines, now);
  const afterVolume = Math.max(0, subtotal - volume.amount);
  const labels = [...volume.labels];
  let extra = 0;
  const auto = checkout.automaticDiscount;
  if (auto && inDiscountWindow(auto, now) && subtotal >= (auto.minSubtotal ?? 0) && afterVolume > 0) {
    extra = Math.min(afterVolume, auto.type === "percent" ? (afterVolume * auto.value) / 100 : auto.value);
    if (extra > 0) labels.push(auto.label ?? "Automatic discount");
  }
  const amount = Math.round((volume.amount + extra) * 100) / 100;
  return { amount: Math.min(amount, subtotal), labels };
}
