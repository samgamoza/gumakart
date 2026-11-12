/**
 * Display + validation helpers for Philippine phone numbers and payment labels.
 * Display only: the API stores and validates numbers itself. Numbers that don't look
 * Philippine are shown as typed, so shops selling abroad still read correctly.
 */

/** "09171234567" | "+639171234567" | "639171234567" → "09171234567"; anything else → null. */
export function normalizePhMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^\+639\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return null;
}

export function isValidPhMobile(raw: string | null | undefined): boolean {
  return normalizePhMobile(raw) !== null;
}

/** "09171234567" → "0917 123 4567". Non-PH numbers come back unchanged. */
export function formatPhPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const local = normalizePhMobile(raw);
  if (!local) return raw.trim();
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** tel: href that dials from any phone ("+639171234567"). */
export function telHref(raw: string | null | undefined): string {
  const local = normalizePhMobile(raw);
  return `tel:${local ? `+63${local.slice(1)}` : (raw ?? "").replace(/[^\d+]/g, "")}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  maya: "Maya",
  cod: "Cash on delivery",
  bank: "Bank transfer",
  qrph: "QR Ph",
  card: "Card",
  cash: "Cash",
  gift_card: "Gift card",
};

/** "paymaya" → "Maya", "cod" → "Cash on delivery". Unknown methods are title-cased. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  const key = method.toLowerCase();
  return PAYMENT_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
