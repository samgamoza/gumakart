/**
 * Demo data + pure helpers for the Guma Kart social-checkout flow.
 * UI-first: nothing here touches the database. Swap for real queries later.
 */

export type PaymentMethod = "gcash" | "maya" | "cod";

export interface KartSeller {
  name: string;
  handle: string;
  messengerUrl: string;
  pickupProvinceCode: string; // used by the demo BayanGo quote
}

export interface KartProduct {
  id: string;
  title: string;
  price: number;
  stock: number;
  keyword: string;
  /** Short variant line shown under the title */
  variant?: string;
}

export interface TriggerConfig {
  keyword: string;
  title: string;
  price: number;
  stock: number;
  listenerOn: boolean;
}

export interface ShippingQuote {
  amount: number;
  eta: string;
  zone: "metro" | "luzon" | "visayas" | "mindanao";
}

export const SELLER: KartSeller = {
  name: "Tita Bea's Closet",
  handle: "@titabeascloset",
  messengerUrl: "https://m.me/titabeascloset",
  pickupProvinceCode: "1300", // Metro Manila
};

export const PRODUCT: KartProduct = {
  id: "vcj-01",
  title: "Vintage Corduroy Jacket",
  variant: "Size M · Camel",
  price: 1250,
  stock: 3,
  keyword: "MINE",
};

export const DEFAULT_TRIGGER: TriggerConfig = {
  keyword: PRODUCT.keyword,
  title: PRODUCT.title,
  price: PRODUCT.price,
  stock: PRODUCT.stock,
  listenerOn: false,
};

export const COD_FEE = 25;
export const CART_HOLD_MINUTES = 30;

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; note: string }[] = [
  { id: "gcash", label: "GCash", note: "Instant confirmation" },
  { id: "maya", label: "Maya", note: "Instant confirmation" },
  { id: "cod", label: "Cash on Delivery", note: `+₱${COD_FEE} handling fee, pay the rider` },
];

export function peso(n: number): string {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;
}

/** Demo BayanGo quote by PSGC region code. Replace with the live quote API. */
export function quoteShipping(regionCode: string, provinceCode: string): ShippingQuote | null {
  if (!regionCode) return null;
  if (provinceCode === SELLER.pickupProvinceCode) return { amount: 79, eta: "Same day", zone: "metro" };
  const r = Number(regionCode);
  if (regionCode === "13" || (r >= 1 && r <= 5) || regionCode === "14") {
    return { amount: 120, eta: "1–2 days", zone: "luzon" };
  }
  if (r >= 6 && r <= 8) return { amount: 165, eta: "2–4 days", zone: "visayas" };
  return { amount: 195, eta: "3–5 days", zone: "mindanao" };
}

export function computeTotals(price: number, shipping: number | null, method: PaymentMethod | null) {
  const codFee = method === "cod" ? COD_FEE : 0;
  const ship = shipping ?? 0;
  return { subtotal: price, shipping: ship, codFee, total: price + ship + codFee };
}

/** Post-purchase timeline (spec §D). */
export const TRACK_STEPS = [
  { key: "locked", label: "Order locked", hint: "Stock reserved for you" },
  { key: "packing", label: "Packing", hint: "Seller is preparing the parcel" },
  { key: "handed", label: "Handed to BayanGo rider", hint: "Waybill generated" },
  { key: "otd", label: "Out for delivery", hint: "Rider is on the way" },
  { key: "arrived", label: "Arrived", hint: "Salamat po!" },
] as const;

export type TrackStepKey = (typeof TRACK_STEPS)[number]["key"];

export interface PlacedOrder {
  number: string;
  placedAt: string;
  buyer: { name: string; phone: string };
  addressText: string;
  method: PaymentMethod;
  totals: ReturnType<typeof computeTotals>;
  shipping: ShippingQuote;
  product: KartProduct;
}

export const ORDER_STORAGE_KEY = "kart:last-order";

export function makeOrderNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `GK-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function dmMessage(buyer: string, title: string, price: number): string {
  return `Hey ${buyer}! ⚡ We've locked in your ${title} (${peso(price)}). Tap below to securely enter your delivery details and choose your payment method before cart expiration!`;
}

/** 09XX XXX XXXX / +63 formats. Mobile is the account key (spec §3.2). */
export function normalizePhMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}
