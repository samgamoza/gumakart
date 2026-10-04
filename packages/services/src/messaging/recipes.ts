/**
 * Automatic SMS recipes (plan Phase 4). Pure text builders — no I/O — so the
 * wording is unit-tested and the same everywhere (checkout, outbox consumer,
 * timed scans).
 *
 * Rules:
 *  - Every buyer text starts with the shop's name (buyers don't know "Guma").
 *  - Taglish, short, ASCII only ("P" not "₱"): one non-ASCII character makes the
 *    whole SMS UCS-2 (70 chars per segment instead of 160) and doubles the cost.
 *  - Marketing texts (abandoned checkout, unpaid reminder) get the signed
 *    "Stop reminders" link added by withOptOutFooter() at send time.
 */

export type BuyerRecipe =
  | "order_created"
  | "payment_confirmed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "abandoned_checkout"
  | "unpaid_reminder";

export const BUYER_RECIPES: Array<{
  id: BuyerRecipe;
  label: string;
  when: string;
  kind: "transactional" | "marketing";
}> = [
  { id: "order_created", label: "Order received", when: "Right after the buyer orders", kind: "transactional" },
  { id: "payment_confirmed", label: "Payment confirmed", when: "When you (or PayMongo) confirm the payment", kind: "transactional" },
  { id: "shipped", label: "Rider booked / ready for pickup", when: "When a rider is booked, or a pickup order is ready", kind: "transactional" },
  { id: "out_for_delivery", label: "Out for delivery", when: "When the rider has the parcel (with the COD amount)", kind: "transactional" },
  { id: "delivered", label: "Delivered", when: "When the order is delivered or picked up", kind: "transactional" },
  {
    id: "abandoned_checkout",
    label: "Unfinished checkout",
    when: "30 min and 24 h after a buyer stops at checkout — only if they ticked SMS reminders",
    kind: "marketing",
  },
  {
    id: "unpaid_reminder",
    label: "Unpaid order reminder",
    when: "6 h after an e-wallet order with no payment — only if they ticked SMS reminders",
    kind: "marketing",
  },
];

const PAYMENT_NAMES: Record<string, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  maya: "Maya",
  bank: "bank transfer",
  qrph: "QR Ph",
  card: "card",
};

/** "₱1,890.00" / "1890" → "P1,890" (ASCII, no centavos unless needed). */
export function smsPeso(amount: number | string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "P0";
  const fixed = Math.round(n * 100) / 100;
  return `P${fixed.toLocaleString("en-US", { minimumFractionDigits: fixed % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Shop name as an SMS prefix: ASCII-folded, trimmed to 30 chars. */
export function smsShopName(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clean = ascii || "Your shop";
  return clean.length > 30 ? `${clean.slice(0, 29).trimEnd()}.` : clean;
}

function asciiText(text: string, max: number): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}.` : s;
}

export interface OrderSmsContext {
  shopName: string;
  orderNumber: string;
  total: number | string;
  paymentMethod: string;
  /** "delivery" | "pickup" */
  deliveryType: string;
  /** Buyer's order page (with access token). */
  orderUrl?: string | null;
  /** Shop's pickup address (pickup orders). */
  pickupAddress?: string | null;
  /** Courier name for "rider booked", e.g. "Lalamove". */
  courier?: string | null;
  /** Payment still due on handover (COD not yet collected). */
  codDue?: boolean;
}

export function orderCreatedSms(c: OrderSmsContext): string {
  const shop = smsShopName(c.shopName);
  const total = smsPeso(c.total);
  const pickup = c.deliveryType === "pickup";
  const track = c.orderUrl ? ` ${c.orderUrl}` : "";
  if (c.paymentMethod === "cod") {
    return pickup
      ? `${shop}: Salamat sa order! #${c.orderNumber} - ${total}, bayad pag-pickup. Ite-text ka namin kapag ready na.${track}`
      : `${shop}: Salamat sa order! #${c.orderNumber} - ${total}, COD. Ite-text ka namin kapag paalis na.${track}`;
  }
  const via = PAYMENT_NAMES[c.paymentMethod] ?? "e-wallet";
  return `${shop}: Order #${c.orderNumber} - ${total}. Magbayad via ${via} at i-upload ang resibo dito para ma-process:${track || " (see order page)"}`;
}

export function paymentConfirmedSms(c: OrderSmsContext): string {
  const track = c.orderUrl ? ` Track: ${c.orderUrl}` : "";
  return `${smsShopName(c.shopName)}: Natanggap na ang bayad mo (${smsPeso(c.total)}) para sa order #${c.orderNumber}. Ihahanda na namin ito!${track}`;
}

export function riderBookedSms(c: OrderSmsContext): string {
  const via = c.courier ? ` via ${asciiText(c.courier, 20)}` : "";
  const track = c.orderUrl ? ` Track: ${c.orderUrl}` : "";
  return `${smsShopName(c.shopName)}: May rider na ang order #${c.orderNumber}${via}. Ite-text ka namin kapag paparating na.${track}`;
}

export function readyForPickupSms(c: OrderSmsContext): string {
  const where = c.pickupAddress?.trim() ? ` Pickup: ${asciiText(c.pickupAddress, 80)}.` : "";
  const pay = c.codDue ? ` Bayad: ${smsPeso(c.total)} cash.` : "";
  return `${smsShopName(c.shopName)}: Ready na for pickup ang order #${c.orderNumber}!${where}${pay}`;
}

export function outForDeliverySms(c: OrderSmsContext): string {
  const pay = c.codDue ? ` Pakihanda ang ${smsPeso(c.total)} cash.` : "";
  return `${smsShopName(c.shopName)}: Paparating na ang order #${c.orderNumber}!${pay}`;
}

export function deliveredSms(c: OrderSmsContext): string {
  const verb = c.deliveryType === "pickup" ? "Na-pickup na" : "Na-deliver na";
  return `${smsShopName(c.shopName)}: ${verb} ang order #${c.orderNumber}. Salamat sa pagbili!`;
}

export function abandonedCheckoutSms(input: {
  shopName: string;
  productTitle?: string | null;
  url: string;
  step: 1 | 2;
}): string {
  const shop = smsShopName(input.shopName);
  const what = input.productTitle ? asciiText(input.productTitle, 40) : "";
  return input.step === 1
    ? `${shop}: Hindi pa tapos ang order mo${what ? ` ng ${what}` : ""}. Ituloy dito: ${input.url}`
    : `${shop}: Available pa ${what ? `ang ${what}` : "ang order mo"}! Order na bago maubos: ${input.url}`;
}

export function unpaidReminderSms(c: OrderSmsContext): string {
  const via = PAYMENT_NAMES[c.paymentMethod] ?? "e-wallet";
  return `${smsShopName(c.shopName)}: Paalala - hindi pa bayad ang order #${c.orderNumber} (${smsPeso(c.total)}). Magbayad via ${via} at i-upload ang resibo: ${c.orderUrl ?? ""}`.trim();
}

// ─── Seller alerts ───────────────────────────────────────────────────────────

export function sellerNewOrderSms(input: { orderNumber: string; total: number | string; buyerName?: string | null; paymentMethod: string }): string {
  const from = input.buyerName?.trim() ? ` mula kay ${asciiText(input.buyerName, 30)}` : "";
  const pay = input.paymentMethod === "cod" ? "COD" : (PAYMENT_NAMES[input.paymentMethod] ?? input.paymentMethod);
  return `Guma Kart: Bagong order #${input.orderNumber} - ${smsPeso(input.total)} (${pay})${from}. Buksan ang Orders para i-handle.`;
}

export function sellerProofSubmittedSms(input: { orderNumber: string; total: number | string }): string {
  return `Guma Kart: May payment proof na ang order #${input.orderNumber} (${smsPeso(input.total)}). I-check sa GCash/Maya mo at i-confirm sa Orders.`;
}

export function sellerDeliveryFailedSms(input: { orderNumber: string }): string {
  return `Guma Kart: Hindi na-deliver ang order #${input.orderNumber}. Buksan ang Orders para ayusin ang delivery.`;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

/** Manila hour (UTC+8, no DST). */
export function manilaHour(now = new Date()): number {
  return (now.getUTCHours() + 8) % 24;
}

/** Reminders are never sent 9 PM – 8 AM Manila time (they wait for morning). */
export function isQuietHours(now = new Date()): boolean {
  const h = manilaHour(now);
  return h >= 21 || h < 8;
}

/** Recipe toggles: missing = on. */
export function isRecipeEnabled(
  automations: Partial<Record<string, boolean>> | null | undefined,
  recipe: BuyerRecipe
): boolean {
  return automations?.[recipe] !== false;
}
