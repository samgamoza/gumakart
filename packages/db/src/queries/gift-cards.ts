import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import { customers, giftCardTxns, giftCards, tenants } from "../schema/index";

/**
 * Phase 17 — gift cards and store credit. One balance per card; every change is a row in
 * gift_card_txns (issue, redeem, restore, adjust) with the balance after it. Balances are
 * changed only with the card row locked, so two checkouts can't spend the same peso.
 *
 *  - Gift cards: issued by the seller (sold over the counter, a prize, a goodwill credit).
 *  - Store credit: issued instead of cash when a return is refunded as credit.
 *  - Redeeming: online checkout and the POS take part or all of an order from a card;
 *    cancelling or fully refunding that order puts it back (once).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class GiftCardError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INACTIVE" | "EXPIRED" | "EMPTY" | "INVALID" | "SHORT",
    message: string
  ) {
    super(message);
  }
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const money = (n: number) => Math.round(n * 100) / 100;

export function newGiftCardCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `GC-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** "gc 7kq2m9xa" / "GC7KQ2M9XA" / "GC-7KQ2-M9XA" → "GC-7KQ2-M9XA"; null if it can't be a code. */
export function normalizeGiftCardCode(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^(?:GC)?([2-9A-HJ-NP-Z]{8})$/.exec(s);
  return m ? `GC-${m[1]!.slice(0, 4)}-${m[1]!.slice(4)}` : null;
}

export interface GiftCardRow {
  id: string;
  code: string;
  kind: "gift_card" | "store_credit";
  initialAmount: number;
  balance: number;
  status: "active" | "disabled";
  customerId: string | null;
  customerPhone: string | null;
  recipientName: string | null;
  note: string | null;
  expiresAt: Date | null;
  createdByName: string;
  createdAt: Date;
}

function row(r: typeof giftCards.$inferSelect & { customerPhone?: string | null }): GiftCardRow {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    initialAmount: Number(r.initialAmount),
    balance: Number(r.balance),
    status: r.status,
    customerId: r.customerId,
    customerPhone: r.customerPhone ?? null,
    recipientName: r.recipientName,
    note: r.note,
    expiresAt: r.expiresAt,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  };
}

async function customerIdForPhone(tx: Tx | Db, tenantId: string, phone: string | null | undefined, name?: string | null): Promise<string | null> {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ph = /^09\d{9}$/.test(digits) ? digits : /^639\d{9}$/.test(digits) ? `0${digits.slice(2)}` : null;
  if (!ph) return null;
  const [c] = await tx
    .insert(customers)
    .values({ tenantId, phone: ph, name: name?.trim().slice(0, 120) || null })
    .onConflictDoUpdate({ target: [customers.tenantId, customers.phone], set: { updatedAt: new Date() } })
    .returning({ id: customers.id });
  return c?.id ?? null;
}

export async function issueGiftCardInTx(
  tx: Tx,
  input: {
    tenantId: string;
    amount: number;
    kind?: "gift_card" | "store_credit";
    customerPhone?: string | null;
    customerId?: string | null;
    recipientName?: string | null;
    note?: string | null;
    expiresAt?: Date | null;
    createdByName: string;
    orderId?: string | null;
  }
): Promise<GiftCardRow> {
  const amount = money(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new GiftCardError("INVALID", "Enter an amount from ₱1 to ₱1,000,000.");
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw new GiftCardError("INVALID", "The expiry date has to be in the future.");
  const customerId = input.customerId ?? (await customerIdForPhone(tx, input.tenantId, input.customerPhone, input.recipientName));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newGiftCardCode();
    const [card] = await tx
      .insert(giftCards)
      .values({
        tenantId: input.tenantId,
        code,
        kind: input.kind ?? "gift_card",
        initialAmount: amount.toFixed(2),
        balance: amount.toFixed(2),
        customerId,
        recipientName: input.recipientName?.trim().slice(0, 120) || null,
        note: input.note?.trim().slice(0, 200) || null,
        expiresAt: input.expiresAt ?? null,
        createdByName: input.createdByName.slice(0, 80),
      })
      .onConflictDoNothing()
      .returning();
    if (!card) continue;
    await tx.insert(giftCardTxns).values({
      cardId: card.id,
      tenantId: input.tenantId,
      orderId: input.orderId ?? null,
      kind: "issue",
      amount: amount.toFixed(2),
      balanceAfter: amount.toFixed(2),
      note: input.kind === "store_credit" ? "Store credit" : null,
      actorName: input.createdByName.slice(0, 80),
    });
    return row(card);
  }
  throw new Error("Could not make a unique gift card code.");
}

export async function issueGiftCard(input: Parameters<typeof issueGiftCardInTx>[1]): Promise<GiftCardRow> {
  return getDb().transaction((tx) => issueGiftCardInTx(tx, input));
}

export async function listGiftCards(tenantId: string, options: { q?: string | null; limit?: number } = {}): Promise<GiftCardRow[]> {
  const q = options.q?.trim();
  const code = normalizeGiftCardCode(q);
  const rows = await getDb()
    .select({ c: giftCards, customerPhone: customers.phone })
    .from(giftCards)
    .leftJoin(customers, eq(customers.id, giftCards.customerId))
    .where(
      and(
        eq(giftCards.tenantId, tenantId),
        q
          ? or(
              code ? eq(giftCards.code, code) : sql`false`,
              ilike(giftCards.recipientName, `%${q.replace(/[%_]/g, "")}%`),
              ilike(customers.phone, `%${q.replace(/\D/g, "").slice(-10) || "~"}%`)
            )
          : undefined
      )
    )
    .orderBy(desc(giftCards.createdAt))
    .limit(Math.min(options.limit ?? 100, 500));
  return rows.map((r) => row({ ...r.c, customerPhone: r.customerPhone }));
}

export interface GiftCardTxnRow {
  id: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
}

export async function getGiftCardHistory(tenantId: string, cardId: string): Promise<GiftCardTxnRow[]> {
  const rows = await getDb()
    .select()
    .from(giftCardTxns)
    .where(and(eq(giftCardTxns.tenantId, tenantId), eq(giftCardTxns.cardId, cardId)))
    .orderBy(desc(giftCardTxns.createdAt))
    .limit(100);
  return rows.map((r) => ({ id: r.id, kind: r.kind, amount: Number(r.amount), balanceAfter: Number(r.balanceAfter), orderId: r.orderId, note: r.note, actorName: r.actorName, createdAt: r.createdAt }));
}

export async function setGiftCardStatus(tenantId: string, cardId: string, status: "active" | "disabled"): Promise<GiftCardRow> {
  const [card] = await getDb()
    .update(giftCards)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.id, cardId)))
    .returning();
  if (!card) throw new GiftCardError("NOT_FOUND", "That card doesn't exist.");
  return row(card);
}

/** Manager correction (+ or −). Never below zero. */
export async function adjustGiftCard(tenantId: string, cardId: string, delta: number, note: string, actorName: string): Promise<GiftCardRow> {
  const d = money(Number(delta));
  if (!Number.isFinite(d) || d === 0) throw new GiftCardError("INVALID", "Enter how much to add or take off.");
  if (!note.trim()) throw new GiftCardError("INVALID", "Say why (it's kept in the card's history).");
  return getDb().transaction(async (tx) => {
    const [card] = await tx.select().from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.id, cardId))).for("update");
    if (!card) throw new GiftCardError("NOT_FOUND", "That card doesn't exist.");
    const next = money(Number(card.balance) + d);
    if (next < 0) throw new GiftCardError("SHORT", `The card only has ₱${Number(card.balance).toFixed(2)}.`);
    const [updated] = await tx.update(giftCards).set({ balance: next.toFixed(2), updatedAt: new Date() }).where(eq(giftCards.id, card.id)).returning();
    await tx.insert(giftCardTxns).values({ cardId: card.id, tenantId, kind: "adjust", amount: d.toFixed(2), balanceAfter: next.toFixed(2), note: note.trim().slice(0, 200), actorName: actorName.slice(0, 80) });
    return row(updated!);
  });
}

export interface GiftCardCheck {
  code: string;
  balance: number;
  kind: "gift_card" | "store_credit";
  expiresAt: Date | null;
}

function usable(card: typeof giftCards.$inferSelect, now: Date): void {
  if (card.status !== "active") throw new GiftCardError("INACTIVE", "Hindi na magagamit ang card na ito.");
  if (card.expiresAt && card.expiresAt <= now) throw new GiftCardError("EXPIRED", "Expired na ang card na ito.");
  if (Number(card.balance) <= 0) throw new GiftCardError("EMPTY", "Wala nang laman ang card na ito.");
}

/** For the checkout preview: is this code good, and how much is on it? (Doesn't spend.) */
export async function checkGiftCard(tenantId: string, rawCode: string, now = new Date()): Promise<GiftCardCheck> {
  const code = normalizeGiftCardCode(rawCode);
  if (!code) throw new GiftCardError("NOT_FOUND", "Hindi mahanap ang gift card code.");
  const [card] = await getDb().select().from(giftCards).where(and(eq(giftCards.tenantId, tenantId), eq(giftCards.code, code))).limit(1);
  if (!card) throw new GiftCardError("NOT_FOUND", "Hindi mahanap ang gift card code.");
  usable(card, now);
  return { code: card.code, balance: Number(card.balance), kind: card.kind, expiresAt: card.expiresAt };
}

/**
 * Spends up to `maxAmount` from a card for an order (row locked). `exact` (POS tender)
 * requires the full amount to be on the card. Returns what was taken.
 */
export async function redeemGiftCardInTx(
  tx: Tx,
  input: { tenantId: string; code: string; maxAmount: number; orderId: string; actorName: string; exact?: boolean; now?: Date }
): Promise<{ cardId: string; code: string; amount: number; balanceAfter: number }> {
  const code = normalizeGiftCardCode(input.code);
  if (!code) throw new GiftCardError("NOT_FOUND", "Hindi mahanap ang gift card code.");
  const [card] = await tx
    .select()
    .from(giftCards)
    .where(and(eq(giftCards.tenantId, input.tenantId), eq(giftCards.code, code)))
    .for("update");
  if (!card) throw new GiftCardError("NOT_FOUND", "Hindi mahanap ang gift card code.");
  usable(card, input.now ?? new Date());
  const balance = Number(card.balance);
  const want = money(Math.max(0, input.maxAmount));
  if (input.exact && balance + 0.001 < want) throw new GiftCardError("SHORT", `Only ₱${balance.toFixed(2)} left on ${card.code}.`);
  const amount = money(Math.min(balance, want));
  if (amount <= 0) throw new GiftCardError("EMPTY", "Wala nang laman ang card na ito.");
  const after = money(balance - amount);
  await tx.update(giftCards).set({ balance: after.toFixed(2), updatedAt: new Date() }).where(eq(giftCards.id, card.id));
  await tx.insert(giftCardTxns).values({
    cardId: card.id,
    tenantId: input.tenantId,
    orderId: input.orderId,
    kind: "redeem",
    amount: (-amount).toFixed(2),
    balanceAfter: after.toFixed(2),
    actorName: input.actorName.slice(0, 80),
  });
  return { cardId: card.id, code: card.code, amount, balanceAfter: after };
}

/**
 * Puts back everything an order took from cards that hasn't been put back yet (cancel,
 * expiry, full refund, POS void). Safe to call twice.
 */
export async function restoreGiftCardsForOrderInTx(tx: Tx, input: { tenantId: string; orderId: string; actorName: string; note?: string }): Promise<number> {
  const rows = await tx
    .select({ cardId: giftCardTxns.cardId, net: sql<string>`sum(${giftCardTxns.amount})` })
    .from(giftCardTxns)
    .where(and(eq(giftCardTxns.tenantId, input.tenantId), eq(giftCardTxns.orderId, input.orderId), sql`${giftCardTxns.kind} in ('redeem', 'restore')`))
    .groupBy(giftCardTxns.cardId);
  let restored = 0;
  for (const r of rows) {
    const owed = money(-Number(r.net));
    if (owed <= 0) continue;
    const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, r.cardId)).for("update");
    if (!card) continue;
    const after = money(Number(card.balance) + owed);
    await tx.update(giftCards).set({ balance: after.toFixed(2), updatedAt: new Date() }).where(eq(giftCards.id, card.id));
    await tx.insert(giftCardTxns).values({
      cardId: card.id,
      tenantId: input.tenantId,
      orderId: input.orderId,
      kind: "restore",
      amount: owed.toFixed(2),
      balanceAfter: after.toFixed(2),
      note: input.note?.slice(0, 200) ?? "Order cancelled — balance put back",
      actorName: input.actorName.slice(0, 80),
    });
    restored = money(restored + owed);
  }
  return restored;
}

export async function giftCardSummary(tenantId: string): Promise<{ outstanding: number; active: number; redeemed30d: number }> {
  const db = getDb();
  const [a] = await db
    .select({
      outstanding: sql<string>`coalesce(sum(${giftCards.balance}) filter (where ${giftCards.status} = 'active' and (${giftCards.expiresAt} is null or ${giftCards.expiresAt} > now())), 0)`,
      active: sql<number>`count(*) filter (where ${giftCards.status} = 'active' and ${giftCards.balance} > 0)::int`,
    })
    .from(giftCards)
    .where(eq(giftCards.tenantId, tenantId));
  const [b] = await db
    .select({ redeemed: sql<string>`coalesce(-sum(${giftCardTxns.amount}), 0)` })
    .from(giftCardTxns)
    .where(and(eq(giftCardTxns.tenantId, tenantId), eq(giftCardTxns.kind, "redeem"), sql`${giftCardTxns.createdAt} > now() - interval '30 days'`));
  return { outstanding: Number(a?.outstanding ?? 0), active: a?.active ?? 0, redeemed30d: Number(b?.redeemed ?? 0) };
}

/** Storefront / checkout-link preview by shop slug (active shops only). */
export async function checkGiftCardForSlug(slug: string, rawCode: string): Promise<GiftCardCheck> {
  const [t] = await getDb().select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!t || t.status !== "active") throw new GiftCardError("NOT_FOUND", "Hindi mahanap ang gift card code.");
  return checkGiftCard(t.id, rawCode);
}
