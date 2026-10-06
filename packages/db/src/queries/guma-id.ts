import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  buyerAccounts,
  buyerAddresses,
  buyerOtpCodes,
  messagingOptOuts,
  orderItems,
  orders,
  stockAlerts,
  tenants,
  type BuyerAddressJson,
} from "../schema/index";
import { factsOf } from "./order-lifecycle";
import { orderBucketOf } from "./order-state";
import { exportBuyerDemand } from "./demand";

/**
 * Phase 12 — Guma ID: one verified mobile number recognised at every Guma Kart shop.
 *
 * Privacy rules
 *  - Shops never query this module. A shop sees only what the buyer puts on that shop's
 *    order (as before). The buyer's address book stays on their side and only pre-fills
 *    their own checkout.
 *  - "My orders" lists orders whose phone matches the verified number, across shops —
 *    the number is proof the orders are theirs.
 *  - Export gives everything we hold; delete removes the account, addresses and codes and
 *    unlinks (doesn't delete) the shops' orders, which the shops still need.
 *
 * OTP rules: 6 digits, 5 minutes, 5 tries per code, 3 codes per 15 min and 10 per day per
 * number; only a keyed hash is stored. SMS sending happens in the app (Semaphore — ready
 * to hook up).
 */

export class GumaIdError extends Error {
  constructor(
    message: string,
    public code: "BAD_PHONE" | "RATE_LIMITED" | "BAD_CODE" | "CODE_EXPIRED" | "TOO_MANY_TRIES" | "NOT_FOUND" | "INVALID" | "LIMIT"
  ) {
    super(message);
    this.name = "GumaIdError";
  }
}

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_TRIES = 5;
export const MAX_ADDRESSES = 10;

/** 09XXXXXXXXX or null. Accepts +63 / 63 / 9XXXXXXXXX / spaces / dashes. */
export function normalizeBuyerPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return d;
  if (/^639\d{9}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9\d{9}$/.test(d)) return `0${d}`;
  return null;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigits(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

/**
 * Creates a login code for a number. Returns the plain code for the caller to text;
 * only its keyed hash is stored. Throws RATE_LIMITED when the number asked too often.
 */
export async function createBuyerOtp(rawPhone: string, secret: string, ip?: string | null): Promise<{ phone: string; code: string; expiresAt: Date }> {
  const phone = normalizeBuyerPhone(rawPhone);
  if (!phone) throw new GumaIdError("Ilagay ang tamang mobile number (09XX XXX XXXX).", "BAD_PHONE");
  const db = getDb();
  const [{ recent, today }] = (await db
    .select({
      recent: sql<number>`count(*) filter (where ${buyerOtpCodes.createdAt} > now() - interval '15 minutes')::int`,
      today: sql<number>`count(*) filter (where ${buyerOtpCodes.createdAt} > now() - interval '24 hours')::int`,
    })
    .from(buyerOtpCodes)
    .where(eq(buyerOtpCodes.phone, phone))) as [{ recent: number; today: number }];
  if (recent >= 3 || today >= 10) {
    throw new GumaIdError("Masyadong maraming code ang hiningi. Subukan ulit mamaya.", "RATE_LIMITED");
  }
  const code = sixDigits();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  // Older open codes stop working: only the newest one counts.
  await db.update(buyerOtpCodes).set({ consumedAt: new Date() }).where(and(eq(buyerOtpCodes.phone, phone), isNull(buyerOtpCodes.consumedAt)));
  await db.insert(buyerOtpCodes).values({ phone, codeHash: await hmacHex(secret, `${phone}:${code}`), expiresAt, ip: ip?.slice(0, 64) ?? null });
  return { phone, code, expiresAt };
}

export interface BuyerAccount {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  preferredPayment: string | null;
  sessionVersion: number;
  createdAt: Date;
}

function toBuyer(r: typeof buyerAccounts.$inferSelect): BuyerAccount {
  return { id: r.id, phone: r.phone, name: r.name, email: r.email, preferredPayment: r.preferredPayment, sessionVersion: r.sessionVersion, createdAt: r.createdAt };
}

/** Checks a code; on success creates the account if new. */
export async function verifyBuyerOtp(rawPhone: string, rawCode: string, secret: string): Promise<{ buyer: BuyerAccount; isNew: boolean }> {
  const phone = normalizeBuyerPhone(rawPhone);
  const code = (rawCode ?? "").replace(/\D/g, "");
  if (!phone) throw new GumaIdError("Ilagay ang tamang mobile number.", "BAD_PHONE");
  if (code.length !== 6) throw new GumaIdError("Ilagay ang 6-digit code.", "BAD_CODE");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [otp] = await tx
      .select()
      .from(buyerOtpCodes)
      .where(and(eq(buyerOtpCodes.phone, phone), isNull(buyerOtpCodes.consumedAt)))
      .orderBy(desc(buyerOtpCodes.createdAt))
      .limit(1)
      .for("update");
    if (!otp) throw new GumaIdError("Humingi muna ng code.", "BAD_CODE");
    if (otp.expiresAt <= new Date()) throw new GumaIdError("Expired na ang code. Humingi ng bago.", "CODE_EXPIRED");
    if (otp.attempts >= OTP_MAX_TRIES) throw new GumaIdError("Sobra na ang subok. Humingi ng bagong code.", "TOO_MANY_TRIES");
    const ok = (await hmacHex(secret, `${phone}:${code}`)) === otp.codeHash;
    if (!ok) {
      await tx.update(buyerOtpCodes).set({ attempts: otp.attempts + 1 }).where(eq(buyerOtpCodes.id, otp.id));
      // The failed try must stick even though we throw: commit it by returning a marker.
      return { failed: true as const, left: OTP_MAX_TRIES - otp.attempts - 1 };
    }
    await tx.update(buyerOtpCodes).set({ consumedAt: new Date() }).where(eq(buyerOtpCodes.id, otp.id));
    const [existing] = await tx.select().from(buyerAccounts).where(eq(buyerAccounts.phone, phone)).limit(1);
    if (existing) {
      const [u] = await tx.update(buyerAccounts).set({ lastSeenAt: new Date() }).where(eq(buyerAccounts.id, existing.id)).returning();
      return { failed: false as const, buyer: toBuyer(u!), isNew: false };
    }
    const [created] = await tx
      .insert(buyerAccounts)
      .values({ phone, termsAcceptedAt: new Date(), lastSeenAt: new Date() })
      .onConflictDoNothing()
      .returning();
    const row = created ?? (await tx.select().from(buyerAccounts).where(eq(buyerAccounts.phone, phone)).limit(1))[0]!;
    return { failed: false as const, buyer: toBuyer(row), isNew: Boolean(created) };
  }).then((r) => {
    if (r.failed) {
      throw new GumaIdError(r.left > 0 ? `Mali ang code. ${r.left} subok pa.` : "Sobra na ang subok. Humingi ng bagong code.", r.left > 0 ? "BAD_CODE" : "TOO_MANY_TRIES");
    }
    return { buyer: r.buyer, isNew: r.isNew };
  });
}

export async function getBuyer(id: string): Promise<BuyerAccount | null> {
  const [r] = await getDb().select().from(buyerAccounts).where(eq(buyerAccounts.id, id)).limit(1);
  return r ? toBuyer(r) : null;
}

export async function updateBuyerProfile(
  id: string,
  input: { name?: string | null; email?: string | null; preferredPayment?: string | null }
): Promise<BuyerAccount> {
  const set: Partial<typeof buyerAccounts.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name?.trim().replace(/\s+/g, " ").slice(0, 120) || null;
  if (input.email !== undefined) {
    const e = input.email?.trim().toLowerCase() || null;
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new GumaIdError("Mali ang email.", "INVALID");
    set.email = e;
  }
  if (input.preferredPayment !== undefined) {
    const p = input.preferredPayment || null;
    if (p && !["gcash", "paymaya", "cod", "bank", "qrph", "card"].includes(p)) throw new GumaIdError("Mali ang payment.", "INVALID");
    set.preferredPayment = p;
  }
  const [r] = await getDb().update(buyerAccounts).set(set).where(eq(buyerAccounts.id, id)).returning();
  if (!r) throw new GumaIdError("Account not found.", "NOT_FOUND");
  return toBuyer(r);
}

/** Sign out everywhere. */
export async function bumpBuyerSession(id: string): Promise<void> {
  await getDb().update(buyerAccounts).set({ sessionVersion: sql`${buyerAccounts.sessionVersion} + 1` }).where(eq(buyerAccounts.id, id));
}

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface BuyerAddress {
  id: string;
  label: string | null;
  recipient: string | null;
  address: BuyerAddressJson;
  isDefault: boolean;
}

function cleanAddress(a: BuyerAddressJson): BuyerAddressJson {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const out: BuyerAddressJson = {
    line1: s(a.line1, 200),
    regionCode: s(a.regionCode, 20),
    region: s(a.region, 80),
    provinceCode: s(a.provinceCode, 20),
    province: s(a.province, 80),
    cityCode: s(a.cityCode, 20),
    city: s(a.city, 80),
    barangay: s(a.barangay, 80),
    landmark: s(a.landmark, 120),
  };
  if (out.line1.length < 3 || !out.city) throw new GumaIdError("Kulang ang address (street at city).", "INVALID");
  return out;
}

export async function listBuyerAddresses(buyerId: string): Promise<BuyerAddress[]> {
  const rows = await getDb()
    .select()
    .from(buyerAddresses)
    .where(eq(buyerAddresses.buyerId, buyerId))
    .orderBy(desc(buyerAddresses.isDefault), asc(buyerAddresses.createdAt));
  return rows.map((r) => ({ id: r.id, label: r.label, recipient: r.recipient, address: r.addressJson, isDefault: r.isDefault }));
}

export async function saveBuyerAddress(
  buyerId: string,
  input: { id?: string | null; label?: string | null; recipient?: string | null; address: BuyerAddressJson; makeDefault?: boolean }
): Promise<BuyerAddress[]> {
  const address = cleanAddress(input.address);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.select({ id: buyerAccounts.id }).from(buyerAccounts).where(eq(buyerAccounts.id, buyerId)).for("update");
    const existing = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerId));
    const first = existing.length === 0;
    if (!input.id && existing.length >= MAX_ADDRESSES) throw new GumaIdError(`Hanggang ${MAX_ADDRESSES} address lang.`, "LIMIT");
    if (input.makeDefault || first) await tx.update(buyerAddresses).set({ isDefault: false }).where(eq(buyerAddresses.buyerId, buyerId));
    const values = {
      label: input.label?.trim().slice(0, 40) || null,
      recipient: input.recipient?.trim().slice(0, 120) || null,
      addressJson: address,
      ...(input.makeDefault || first ? { isDefault: true } : {}),
    };
    if (input.id) {
      const updated = await tx.update(buyerAddresses).set(values).where(and(eq(buyerAddresses.id, input.id), eq(buyerAddresses.buyerId, buyerId))).returning({ id: buyerAddresses.id });
      if (updated.length === 0) throw new GumaIdError("Address not found.", "NOT_FOUND");
    } else {
      await tx.insert(buyerAddresses).values({ buyerId, ...values });
    }
  });
  return listBuyerAddresses(buyerId);
}

export async function deleteBuyerAddress(buyerId: string, addressId: string): Promise<BuyerAddress[]> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [gone] = await tx.delete(buyerAddresses).where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.buyerId, buyerId))).returning({ isDefault: buyerAddresses.isDefault });
    if (gone?.isDefault) {
      const [next] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerId)).orderBy(asc(buyerAddresses.createdAt)).limit(1);
      if (next) await tx.update(buyerAddresses).set({ isDefault: true }).where(eq(buyerAddresses.id, next.id));
    }
  });
  return listBuyerAddresses(buyerId);
}

// ─── Orders across shops ─────────────────────────────────────────────────────

const phoneTail = (col: unknown) => sql`right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 10)`;

export interface BuyerOrder {
  id: string;
  orderNumber: string;
  shopName: string;
  shopSlug: string;
  createdAt: Date;
  total: number;
  refunded: number;
  itemsSummary: string;
  bucket: string;
  orderState: string;
  paymentState: string;
  fulfillmentState: string;
  /** Link to the order page (carries the order's access token). */
  orderPath: string | null;
  checkoutLinkCode: string | null;
}

/** Orders placed with this number (or linked to the account), newest first, all shops. */
export async function listBuyerOrders(buyer: { id: string; phone: string }, limit = 100): Promise<BuyerOrder[]> {
  const db = getDb();
  const tail = buyer.phone.slice(-10);
  const rows = await db
    .select({ order: orders, shopName: tenants.name, shopSlug: tenants.slug })
    .from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(and(or(eq(orders.buyerAccountId, buyer.id), sql`${phoneTail(orders.guestPhone)} = ${tail}`), sql`coalesce(${orders.sourceChannel}, '') <> 'pos'`))
    .orderBy(desc(orders.createdAt))
    .limit(Math.min(limit, 200));
  if (rows.length === 0) return [];
  const items = await db
    .select({ orderId: orderItems.orderId, title: orderItems.titleSnapshot, qty: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.order.id)));
  const byOrder = new Map<string, string[]>();
  for (const i of items) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), `${i.qty}× ${i.title}`]);
  const linkCodes = await (async () => {
    const ids = [...new Set(rows.map((r) => r.order.checkoutLinkId).filter((x): x is string => Boolean(x)))];
    if (!ids.length) return new Map<string, string>();
    const { checkoutLinks } = await import("../schema/index");
    const l = await db.select({ id: checkoutLinks.id, code: checkoutLinks.code }).from(checkoutLinks).where(inArray(checkoutLinks.id, ids));
    return new Map(l.map((x) => [x.id, x.code]));
  })();
  return rows.map(({ order: o, shopName, shopSlug }) => {
    const facts = factsOf(o);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      shopName,
      shopSlug,
      createdAt: o.createdAt,
      total: Number(o.total),
      refunded: Number(o.refundedAmount ?? 0),
      itemsSummary: (byOrder.get(o.id) ?? []).join(", "),
      bucket: orderBucketOf(facts),
      orderState: facts.orderState,
      paymentState: facts.paymentState,
      fulfillmentState: facts.fulfillmentState,
      orderPath: o.accessToken ? `/${shopSlug}/orders/${encodeURIComponent(o.orderNumber)}?t=${o.accessToken}` : null,
      checkoutLinkCode: o.checkoutLinkId ? linkCodes.get(o.checkoutLinkId) ?? null : null,
    };
  });
}

/** Links an order to the buyer when the order's phone is the buyer's verified number. */
export async function linkOrderToBuyer(orderId: string, buyer: { id: string; phone: string }): Promise<boolean> {
  const rows = await getDb()
    .update(orders)
    .set({ buyerAccountId: buyer.id })
    .where(and(eq(orders.id, orderId), sql`${phoneTail(orders.guestPhone)} = ${buyer.phone.slice(-10)}`))
    .returning({ id: orders.id });
  return rows.length > 0;
}

// ─── Reminder texts per shop ─────────────────────────────────────────────────

export interface BuyerShopPrefs {
  tenantId: string;
  shopName: string;
  shopSlug: string;
  remindersOff: boolean;
}

/** Shops the buyer ordered from, with whether marketing/reminder texts are off. */
export async function listBuyerShops(buyer: { id: string; phone: string }): Promise<BuyerShopPrefs[]> {
  const db = getDb();
  const tail = buyer.phone.slice(-10);
  const shops = await db
    .selectDistinct({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(or(eq(orders.buyerAccountId, buyer.id), sql`${phoneTail(orders.guestPhone)} = ${tail}`));
  if (!shops.length) return [];
  const outs = await db
    .select({ tenantId: messagingOptOuts.tenantId })
    .from(messagingOptOuts)
    .where(and(eq(messagingOptOuts.phone, buyer.phone), eq(messagingOptOuts.channel, "sms")));
  const off = new Set(outs.map((o) => o.tenantId ?? "*"));
  return shops
    .map((s) => ({ tenantId: s.id, shopName: s.name, shopSlug: s.slug, remindersOff: off.has("*") || off.has(s.id) }))
    .sort((a, b) => a.shopName.localeCompare(b.shopName));
}

export async function setBuyerShopReminders(buyer: { phone: string }, tenantId: string, on: boolean): Promise<void> {
  const db = getDb();
  if (on) {
    await db.delete(messagingOptOuts).where(and(eq(messagingOptOuts.phone, buyer.phone), eq(messagingOptOuts.tenantId, tenantId), eq(messagingOptOuts.channel, "sms")));
  } else {
    const [exists] = await db
      .select({ id: messagingOptOuts.id })
      .from(messagingOptOuts)
      .where(and(eq(messagingOptOuts.phone, buyer.phone), eq(messagingOptOuts.tenantId, tenantId), eq(messagingOptOuts.channel, "sms")))
      .limit(1);
    if (!exists) await db.insert(messagingOptOuts).values({ phone: buyer.phone, tenantId, channel: "sms", scope: "marketing", source: "admin" });
  }
}

// ─── Export / delete ─────────────────────────────────────────────────────────

export async function exportBuyerData(buyerId: string): Promise<Record<string, unknown> | null> {
  const buyer = await getBuyer(buyerId);
  if (!buyer) return null;
  const [addresses, orderList, shops, demand] = await Promise.all([
    listBuyerAddresses(buyerId),
    listBuyerOrders(buyer, 200),
    listBuyerShops(buyer),
    exportBuyerDemand(buyerId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { phone: buyer.phone, name: buyer.name, email: buyer.email, preferredPayment: buyer.preferredPayment, createdAt: buyer.createdAt },
    addresses: addresses.map((a) => ({ label: a.label, recipient: a.recipient, address: a.address, isDefault: a.isDefault })),
    orders: orderList.map((o) => ({ shop: o.shopName, orderNumber: o.orderNumber, createdAt: o.createdAt, total: o.total, refunded: o.refunded, items: o.itemsSummary, status: o.bucket })),
    reminderTexts: shops.map((s) => ({ shop: s.shopName, on: !s.remindersOff })),
    savedItems: demand.saved,
    backInStockAlerts: demand.alerts,
    note: "Orders belong to the shops you bought from; deleting your Guma ID unlinks them but the shops keep their records.",
  };
}

/** Deletes the Guma ID: account, addresses, codes, saved items and stock alerts. Shops keep their orders (unlinked). */
export async function deleteBuyerAccount(buyerId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(buyerAccounts).where(eq(buyerAccounts.id, buyerId)).for("update");
    if (!b) return;
    await tx.update(orders).set({ buyerAccountId: null }).where(eq(orders.buyerAccountId, buyerId));
    // Phase 22: saved items cascade with the account; back-in-stock alerts hold contact details, so remove them.
    await tx.delete(stockAlerts).where(eq(stockAlerts.buyerAccountId, buyerId));
    await tx.delete(buyerOtpCodes).where(eq(buyerOtpCodes.phone, b.phone));
    await tx.delete(buyerAccounts).where(eq(buyerAccounts.id, buyerId));
  });
}

/** Share of non-POS orders placed by signed-in Guma ID buyers in a window (ops metric). */
export async function gumaIdShare(sinceIso: string): Promise<{ orders: number; withGumaId: number }> {
  const [r] = (await getDb()
    .select({
      orders: sql<number>`count(*)::int`,
      withId: sql<number>`count(*) filter (where ${orders.buyerAccountId} is not null)::int`,
    })
    .from(orders)
    .where(and(gt(orders.createdAt, sql`${sinceIso}::timestamptz`), sql`coalesce(${orders.sourceChannel}, '') <> 'pos'`))) as [{ orders: number; withId: number }];
  return { orders: r.orders, withGumaId: r.withId };
}
export type { BuyerAddressJson } from "../schema/index";
