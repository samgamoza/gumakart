/**
 * Philippine VAT and Senior Citizen / PWD rules for POS sales.
 * Ported from Veyron `app/core/tax.py` (logic and test cases, not code).
 *
 * - VAT-inclusive pricing is the PH retail norm: ₱112 = ₱100 net + ₱12 VAT (extracted, not added).
 * - Senior/PWD sales are VAT-EXEMPT: strip VAT first, then 20% off the VAT-exclusive amount
 *   (net = gross / 1.12; discount = net × 0.20; due = net − discount). 20% off ₱112 (₱89.60) is wrong.
 * - Non-VAT-registered sellers charge no VAT; the senior/PWD 20% applies to the price as-is.
 *
 * Pure (no I/O) so the admin POS screen and the server use the same numbers.
 * BIR OR/SI numbering and X/Z readings are out of scope (V1.1).
 */

export const DEFAULT_VAT_RATE = 0.12;
export const SENIOR_PWD_DISCOUNT_RATE = 0.2;

export type PosDiscountType = "none" | "senior" | "pwd";

export interface VatConfig {
  rate: number;
  inclusive: boolean;
  registered: boolean;
}

/** Most small PH sellers aren't VAT-registered, so V1 defaults to "no VAT". */
export const DEFAULT_POS_VAT: VatConfig = { rate: DEFAULT_VAT_RATE, inclusive: true, registered: false };

export interface SaleTotals {
  subtotal: number;
  discountAmount: number;
  netOfVat: number;
  vatAmount: number;
  vatExemptSales: number;
  total: number;
  vatRate: number;
  vatInclusive: boolean;
  vatExempt: boolean;
}

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function vatConfigFromSettings(settings: { vatRate?: unknown; vatInclusive?: unknown; vatRegistered?: unknown } | null | undefined): VatConfig {
  const s = settings ?? {};
  let rate = DEFAULT_VAT_RATE;
  if (s.vatRate !== undefined && s.vatRate !== null && s.vatRate !== "") {
    const parsed = Number(s.vatRate);
    rate = Number.isFinite(parsed) ? parsed : DEFAULT_VAT_RATE;
  }
  if (rate < 0 || rate >= 1) {
    // "12" typed instead of "0.12".
    rate = rate >= 1 && rate <= 100 ? rate / 100 : DEFAULT_VAT_RATE;
  }
  return {
    rate,
    inclusive: asBool(s.vatInclusive, true),
    registered: asBool(s.vatRegistered, DEFAULT_POS_VAT.registered),
  };
}

export function computeSaleTotals(input: {
  subtotal: number;
  discountRate?: number;
  discountType?: PosDiscountType | string;
  config?: VatConfig;
}): SaleTotals {
  const cfg = input.config ?? DEFAULT_POS_VAT;
  const subtotal = Number(input.subtotal) || 0;
  const discountRate = Number(input.discountRate) || 0;
  const customerExempt = ["senior", "pwd"].includes(String(input.discountType ?? "none").trim().toLowerCase());
  const exempt = !cfg.registered || customerExempt;
  const rate = cfg.rate;

  let discountAmount: number;
  let netOfVat: number;
  let vatAmount: number;
  let total: number;

  if (cfg.inclusive) {
    if (!cfg.registered) {
      discountAmount = subtotal * discountRate;
      total = subtotal - discountAmount;
      netOfVat = total;
      vatAmount = 0;
    } else if (customerExempt) {
      const netBefore = rate ? subtotal / (1 + rate) : subtotal;
      discountAmount = netBefore * discountRate;
      total = netBefore - discountAmount;
      netOfVat = total;
      vatAmount = 0;
    } else {
      discountAmount = subtotal * discountRate;
      const grossAfter = subtotal - discountAmount;
      netOfVat = rate ? grossAfter / (1 + rate) : grossAfter;
      vatAmount = grossAfter - netOfVat;
      total = grossAfter;
    }
  } else {
    discountAmount = subtotal * discountRate;
    netOfVat = subtotal - discountAmount;
    vatAmount = exempt ? 0 : netOfVat * rate;
    total = netOfVat + vatAmount;
  }

  return {
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    netOfVat: money(netOfVat),
    vatAmount: money(vatAmount),
    vatExemptSales: money(exempt ? netOfVat : 0),
    total: money(total),
    vatRate: exempt ? 0 : rate,
    vatInclusive: cfg.inclusive,
    vatExempt: exempt,
  };
}

export function discountRateFor(type: PosDiscountType): number {
  return type === "senior" || type === "pwd" ? SENIOR_PWD_DISCOUNT_RATE : 0;
}

export type PosTenderMethod = "cash" | "gcash" | "maya" | "card";

export interface PosTender {
  method: PosTenderMethod;
  amount: number;
  reference?: string | null;
}

export type TenderCheck =
  | { ok: true; change: number; paidByMethod: Record<PosTenderMethod, number> }
  | { ok: false; error: string };

/**
 * Up to two tenders. Only cash can be over-tendered (that's the change);
 * GCash / Maya / card must not exceed what's due.
 */
export function checkTenders(total: number, tenders: PosTender[]): TenderCheck {
  if (tenders.length === 0) return { ok: false, error: "Add a payment." };
  if (tenders.length > 2) return { ok: false, error: "Up to two payment methods per sale." };
  const methods = new Set(tenders.map((t) => t.method));
  if (methods.size !== tenders.length) return { ok: false, error: "Use each payment method once." };
  const cents = (n: number) => Math.round(n * 100);
  const due = cents(total);
  let cash = 0;
  let other = 0;
  const paidByMethod: Record<PosTenderMethod, number> = { cash: 0, gcash: 0, maya: 0, card: 0 };
  for (const t of tenders) {
    const amount = cents(Number(t.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Payment amounts must be more than zero." };
    if (t.method === "cash") cash += amount;
    else other += amount;
  }
  if (other > due) return { ok: false, error: "GCash, Maya or card can't be more than the amount due." };
  if (cash + other < due) return { ok: false, error: `Still short by ₱${((due - cash - other) / 100).toFixed(2)}.` };
  const change = cash + other - due;
  if (change > cash) return { ok: false, error: "Change can only come from cash." };
  for (const t of tenders) {
    paidByMethod[t.method] += cents(Number(t.amount));
  }
  // What the drawer keeps: cash received minus change.
  paidByMethod.cash -= change;
  return {
    ok: true,
    change: change / 100,
    paidByMethod: Object.fromEntries(Object.entries(paidByMethod).map(([k, v]) => [k, v / 100])) as Record<PosTenderMethod, number>,
  };
}
