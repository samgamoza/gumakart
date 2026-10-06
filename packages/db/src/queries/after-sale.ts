import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  orderItems,
  orderReturns,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  type OrderReturnItem,
} from "../schema/index";
import { applyOrderActionInTx, applyWalletEffects, restockOrderInTx, type ApplyOrderActionResult } from "./order-lifecycle";
import { OrderError } from "./order-status";
import { issueGiftCardInTx, restoreGiftCardsForOrderInTx } from "./gift-cards";
import { recordStockMovement } from "./stock-ledger";

/**
 * Phase 11 — after-sale.
 *
 *  - Notes and tags: seller-only, never shown to the buyer.
 *  - Edit an order before it's packed: change quantities, remove or add items. Stock moves
 *    with every change. A paid order can only go down (the difference is refunded).
 *  - Returns and exchanges after the buyer has the goods (delivered / POS): per item,
 *    restock or not, refund any amount up to what's left. Exchange = return + hand over
 *    another size/colour of the same product. When refunds reach the order total the order
 *    becomes "refunded" through the normal state machine.
 *  - POS void: reverse a sale in the same open shift (stock back, removed from the drawer).
 *
 * Money rules: one order row lock per operation; amounts in centavos; refunds never exceed
 * total − refunded_amount; PayMongo refunds go through the injected gateway callback
 * (ready to hook up), everything else is "returned by the shop" and recorded as such.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const c = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);
const peso = (centavos: number) => (centavos / 100).toFixed(2);

export interface Actor {
  userId: string | null;
  name: string;
  posStaffId?: string | null;
}

async function lockOrder(tx: Tx, tenantId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .for("update");
  if (!order) throw new OrderError("Order not found.", "ORDER_NOT_FOUND");
  return order;
}

// ─── Notes & tags ────────────────────────────────────────────────────────────

export const MAX_TAGS = 10;

export function normalizeTags(raw: string[]): string[] {
  const out: string[] = [];
  for (const t of raw) {
    const tag = t.trim().replace(/\s+/g, " ").slice(0, 24);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function updateOrderNotes(
  tenantId: string,
  orderId: string,
  input: { staffNote?: string | null; tags?: string[] }
): Promise<{ staffNote: string | null; tags: string[] }> {
  const set: { staffNote?: string | null; tagsJson?: string[] } = {};
  if (input.staffNote !== undefined) set.staffNote = input.staffNote?.trim().slice(0, 2000) || null;
  if (input.tags !== undefined) set.tagsJson = normalizeTags(input.tags);
  const [row] = await getDb()
    .update(orders)
    .set(set)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .returning({ staffNote: orders.staffNote, tags: orders.tagsJson });
  if (!row) throw new OrderError("Order not found.", "ORDER_NOT_FOUND");
  return { staffNote: row.staffNote, tags: row.tags ?? [] };
}

/** Tags the shop has used, most used first (for suggestions). */
export async function listOrderTags(tenantId: string): Promise<string[]> {
  const rows = (await getDb().execute(sql`
    select t as tag, count(*) as n
    from ${orders}, jsonb_array_elements_text(coalesce(${orders.tagsJson}, '[]'::jsonb)) as t
    where ${orders.tenantId} = ${tenantId}
    group by 1 order by 2 desc, 1 limit 30
  `)) as unknown as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

// ─── Order detail for after-sale screens ─────────────────────────────────────

export interface AfterSaleLine {
  orderItemId: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  quantity: number;
  returnedQty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface AfterSaleView {
  orderId: string;
  orderNumber: string;
  sourceChannel: string | null;
  orderState: string;
  paymentState: string;
  fulfillmentState: string;
  paymentMethod: string | null;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  refunded: number;
  /** What can still be refunded. */
  refundable: number;
  /** Phase 17: paid by gift card / store credit (restored to the card on a full refund). */
  giftCard: number;
  staffNote: string | null;
  tags: string[];
  canEdit: boolean;
  editBlockedReason: string | null;
  canReturn: boolean;
  returnBlockedReason: string | null;
  paidOnline: boolean;
  lines: AfterSaleLine[];
  history: Array<{
    id: string;
    kind: string;
    items: OrderReturnItem[];
    refundAmount: number;
    collectedAmount: number;
    refundMethod: string;
    note: string | null;
    actorName: string;
    createdAt: Date;
  }>;
}

type OrderRow = typeof orders.$inferSelect;

function editBlocked(order: OrderRow, hasPendingGateway: boolean, hasHistory: boolean): string | null {
  if (order.sourceChannel === "pos") return "POS sales can't be edited — void or return instead.";
  if (order.sourceChannel === "marketplace") return MARKETPLACE_NOTE;
  if (order.orderState !== "open") return "Only open orders can be edited.";
  if (order.fulfillmentState !== "unfulfilled") return "This order is already packed — return items after delivery instead.";
  if (order.paymentState === "pending_verification") return "Confirm or reject the buyer's payment first.";
  if (hasPendingGateway) return "The buyer has an online payment in progress for this amount.";
  if (hasHistory) return "This order already has a return.";
  return null;
}

const MARKETPLACE_NOTE = "Shopee/Lazada handle refunds and returns for their orders; a cancellation there syncs here and restocks.";

function returnBlocked(order: OrderRow, refundableC: number): string | null {
  if (order.sourceChannel === "marketplace") return MARKETPLACE_NOTE;
  if (order.paymentState !== "paid") return "Only paid orders can have returns. Unpaid orders can be edited or cancelled.";
  if (order.fulfillmentState !== "delivered") return "Returns are for orders the buyer already received. Edit or refund the order instead.";
  if (refundableC <= 0) return "Everything on this order was already refunded.";
  return null;
}

export async function getAfterSaleView(tenantId: string, orderId: string): Promise<AfterSaleView | null> {
  const db = getDb();
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
  if (!order) return null;
  const [lines, history, pending] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id)),
    db.select().from(orderReturns).where(and(eq(orderReturns.orderId, orderId), eq(orderReturns.tenantId, tenantId))).orderBy(desc(orderReturns.createdAt)),
    db
      .select({ id: paymentTransactions.id })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.gateway, "paymongo"), eq(paymentTransactions.status, "pending")))
      .limit(1),
  ]);
  const refundableC = Math.max(0, c(order.total) - c(order.giftCardAmount ?? 0) - c(order.refundedAmount));
  const [paid] = await db
    .select({ gateway: paymentTransactions.gateway })
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "paid")))
    .limit(1);
  const edit = editBlocked(order, pending.length > 0, history.some((h) => h.kind !== "edit"));
  const ret = returnBlocked(order, refundableC);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    sourceChannel: order.sourceChannel,
    orderState: order.orderState ?? "open",
    paymentState: order.paymentState ?? "unpaid",
    fulfillmentState: order.fulfillmentState ?? "unfulfilled",
    paymentMethod: order.paymentMethod,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount ?? 0),
    deliveryFee: Number(order.deliveryFee ?? 0),
    total: Number(order.total),
    refunded: Number(order.refundedAmount),
    refundable: refundableC / 100,
    giftCard: Number(order.giftCardAmount ?? 0),
    staffNote: order.staffNote,
    tags: order.tagsJson ?? [],
    canEdit: edit === null,
    editBlockedReason: edit,
    canReturn: ret === null,
    returnBlockedReason: ret,
    paidOnline: paid?.gateway === "paymongo",
    lines: lines.map((l) => ({
      orderItemId: l.id,
      productId: l.productId,
      variantId: l.variantId,
      title: l.titleSnapshot,
      quantity: l.quantity,
      returnedQty: l.returnedQty,
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    })),
    history: history.map((h) => ({
      id: h.id,
      kind: h.kind,
      items: h.itemsJson,
      refundAmount: Number(h.refundAmount),
      collectedAmount: Number(h.collectedAmount),
      refundMethod: h.refundMethod,
      note: h.note,
      actorName: h.actorName,
      createdAt: h.createdAt,
    })),
  };
}

// ─── Stock helpers ───────────────────────────────────────────────────────────

async function moveStock(
  tx: Tx,
  input: { tenantId: string; orderId: string; variantId: string; delta: number; reason: "order_edit" | "return_restock" | "exchange_out"; actorId: string | null; note: string; locationId: string | null },
  title: string
) {
  if (input.delta === 0) return;
  const [track] = await tx
    .select({ track: products.trackInventory })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, input.variantId))
    .limit(1);
  if (!track || track.track === false) return;
  const updated =
    input.delta < 0
      ? await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} + ${input.delta}` })
          .where(and(eq(productVariants.id, input.variantId), sql`coalesce(${productVariants.stockQty}, 0) >= ${-input.delta}`))
          .returning({ stockQty: productVariants.stockQty })
      : await tx
          .update(productVariants)
          .set({ stockQty: sql`coalesce(${productVariants.stockQty}, 0) + ${input.delta}` })
          .where(eq(productVariants.id, input.variantId))
          .returning({ stockQty: productVariants.stockQty });
  if (updated.length === 0) {
    if (input.delta < 0) throw new OrderError(`Not enough stock for "${title}".`, "OUT_OF_STOCK");
    return;
  }
  await recordStockMovement(tx, {
    tenantId: input.tenantId,
    variantId: input.variantId,
    orderId: input.orderId,
    reason: input.reason,
    delta: input.delta,
    balanceAfter: updated[0]!.stockQty,
    actorId: input.actorId,
    note: input.note,
    locationId: input.locationId,
  });
}

// ─── Edit before packing ─────────────────────────────────────────────────────

export interface EditLineInput {
  /** Existing line; omit to add a new item. */
  orderItemId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  qty: number;
}

export interface GatewayPartialRefund {
  (req: { gatewayPaymentId: string; amountCentavos: number; orderNumber: string; reason: string }): Promise<{ refundId?: string }>;
}

export interface EditResult {
  orderNumber: string;
  oldTotal: number;
  newTotal: number;
  /** Paid orders that went down: the difference to give back. */
  refundDue: number;
  refundedAtGateway: boolean;
  summary: string;
}

/**
 * Changes an open, unpacked order. Existing lines keep the price the buyer saw;
 * new lines take today's price. Delivery fee and service fee stay; a fixed
 * discount is capped at the new subtotal.
 */
export async function editOrderItems(
  tenantId: string,
  orderId: string,
  lines: EditLineInput[],
  actor: Actor,
  options: { refundAtGateway?: GatewayPartialRefund; note?: string | null } = {}
): Promise<EditResult> {
  if (lines.length > 100) throw new OrderError("Too many lines.", "INVALID_TRANSITION");
  const db = getDb();
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, tenantId, orderId);
    const [pending] = await tx
      .select({ id: paymentTransactions.id })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.gateway, "paymongo"), eq(paymentTransactions.status, "pending")))
      .limit(1);
    const [anyReturn] = await tx
      .select({ id: orderReturns.id })
      .from(orderReturns)
      .where(and(eq(orderReturns.orderId, orderId), sql`${orderReturns.kind} <> 'edit'`))
      .limit(1);
    const blocked = editBlocked(order, Boolean(pending), Boolean(anyReturn));
    if (blocked) throw new OrderError(blocked, "INVALID_TRANSITION");

    const existing = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const byId = new Map(existing.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const note = `Order edit${options.note ? `: ${options.note}` : ""}`;

    type Planned = { id: string | null; productId: string | null; variantId: string | null; title: string; variantTitle: string | null; qty: number; unitC: number };
    const planned: Planned[] = [];
    for (const input of lines) {
      const qty = Math.trunc(Number(input.qty));
      if (!Number.isFinite(qty) || qty < 0 || qty > 999) throw new OrderError("Quantities must be 0–999.", "INVALID_TRANSITION");
      if (input.orderItemId) {
        const line = byId.get(input.orderItemId);
        if (!line) throw new OrderError("A line changed elsewhere — reload the order.", "INVALID_TRANSITION");
        if (seen.has(line.id)) throw new OrderError("A line is listed twice.", "INVALID_TRANSITION");
        seen.add(line.id);
        planned.push({ id: line.id, productId: line.productId, variantId: line.variantId, title: line.titleSnapshot, variantTitle: line.variantSnapshot, qty, unitC: c(line.unitPrice) });
        continue;
      }
      if (qty === 0) continue;
      if (!input.productId) throw new OrderError("Pick a product to add.", "INVALID_TRANSITION");
      // New item: the shop's active product, the picked (or only) active variant, today's price.
      const rows = await tx
        .select({
          title: products.title,
          status: products.status,
          basePrice: products.basePrice,
          hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
          variantId: productVariants.id,
          variantTitle: productVariants.title,
          variantPrice: productVariants.price,
        })
        .from(products)
        .innerJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.active, true)))
        .where(and(eq(products.id, input.productId), eq(products.tenantId, tenantId)))
        .orderBy(asc(productVariants.position), asc(productVariants.id));
      if (rows.length === 0 || rows[0]!.status !== "active") throw new OrderError("That product isn't available.", "PRODUCT_UNAVAILABLE");
      const first = rows[0]!;
      const row = input.variantId ? rows.find((r) => r.variantId === input.variantId) : first.hasOptions && rows.length > 1 ? null : first;
      if (!row) throw new OrderError(`Pick a size or option for "${first.title}".`, "PRODUCT_UNAVAILABLE");
      planned.push({
        id: null,
        productId: input.productId,
        variantId: row.variantId,
        title: first.hasOptions ? `${first.title} (${row.variantTitle})` : first.title,
        variantTitle: first.hasOptions ? row.variantTitle : null,
        qty,
        unitC: c(first.hasOptions ? row.variantPrice : first.basePrice),
      });
    }
    // Lines not mentioned stay as they are.
    for (const line of existing) {
      if (!seen.has(line.id)) planned.push({ id: line.id, productId: line.productId, variantId: line.variantId, title: line.titleSnapshot, variantTitle: line.variantSnapshot, qty: line.quantity, unitC: c(line.unitPrice) });
    }
    if (!planned.some((p) => p.qty > 0)) throw new OrderError("An order needs at least one item. Cancel it instead.", "EMPTY_CART");

    // Stock: net change per variant (decrements checked, never below zero).
    const delta = new Map<string, { d: number; title: string }>();
    for (const p of planned) {
      if (!p.variantId) continue;
      const before = p.id ? byId.get(p.id)!.quantity : 0;
      const cur = delta.get(p.variantId) ?? { d: 0, title: p.title };
      cur.d += before - p.qty; // positive = goes back to stock
      delta.set(p.variantId, cur);
    }
    for (const [variantId, { d, title }] of [...delta.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      await moveStock(tx, { tenantId, orderId, variantId, delta: d, reason: "order_edit", actorId: actor.userId, note, locationId: order.locationId }, title);
    }

    // Lines.
    const changes: string[] = [];
    for (const p of planned) {
      const old = p.id ? byId.get(p.id)! : null;
      if (old && p.qty === 0) {
        await tx.delete(orderItems).where(eq(orderItems.id, old.id));
        changes.push(`removed ${old.titleSnapshot}`);
      } else if (old && p.qty !== old.quantity) {
        await tx.update(orderItems).set({ quantity: p.qty, lineTotal: peso(p.unitC * p.qty) }).where(eq(orderItems.id, old.id));
        changes.push(`${old.titleSnapshot} ${old.quantity}→${p.qty}`);
      } else if (!old && p.qty > 0) {
        await tx.insert(orderItems).values({
          orderId,
          productId: p.productId,
          variantId: p.variantId,
          titleSnapshot: p.title,
          variantSnapshot: p.variantTitle,
          quantity: p.qty,
          unitPrice: peso(p.unitC),
          lineTotal: peso(p.unitC * p.qty),
          // Phase 14: cost snapshot for profit reports.
          unitCost: p.variantId
            ? ((await tx.select({ c: productVariants.costPrice }).from(productVariants).where(eq(productVariants.id, p.variantId)).limit(1))[0]?.c ?? null)
            : null,
        });
        changes.push(`added ${p.qty}× ${p.title}`);
      }
    }
    if (changes.length === 0) throw new OrderError("Nothing changed.", "INVALID_TRANSITION");

    const subtotalC = planned.reduce((n, p) => n + p.unitC * p.qty, 0);
    const discountC = Math.min(c(order.discount), subtotalC);
    const oldTotalC = c(order.total);
    // Tax scales with the goods; it's in the total only when the shop charges it on top
    // (detected from how the original total was built). The platform service fee is
    // separate from what the buyer pays and scales the same way.
    const oldAfterDiscountC = c(order.subtotal) - c(order.discount);
    const afterDiscountC = subtotalC - discountC;
    const ratio = oldAfterDiscountC > 0 ? afterDiscountC / oldAfterDiscountC : 1;
    const oldTaxC = c(order.tax);
    const taxExclusive = oldTaxC > 0 && Math.abs(oldTotalC - (oldAfterDiscountC + c(order.deliveryFee) + oldTaxC)) <= 1;
    const taxC = Math.round(oldTaxC * ratio);
    const serviceFeeC = Math.round(c(order.serviceFee) * ratio);
    const newTotalC = afterDiscountC + c(order.deliveryFee) + (taxExclusive ? taxC : 0);
    const paid = order.paymentState === "paid";
    if (paid && newTotalC > oldTotalC) {
      throw new OrderError("The buyer already paid. You can lower this order, or make a new order for extra items.", "INVALID_TRANSITION");
    }

    let refundDueC = 0;
    let gatewayRefundId: string | undefined;
    if (paid && newTotalC < oldTotalC) {
      refundDueC = oldTotalC - newTotalC;
      const [txn] = await tx
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "paid")))
        .orderBy(sql`${paymentTransactions.paidAt} desc nulls last`)
        .limit(1);
      if (txn?.gateway === "paymongo") {
        if (!txn.gatewayPaymentId || !options.refundAtGateway) {
          throw new OrderError("This order was paid online — online refunds aren't switched on yet. Refund it from the PayMongo dashboard.", "INVALID_TRANSITION");
        }
        gatewayRefundId = (await options.refundAtGateway({ gatewayPaymentId: txn.gatewayPaymentId, amountCentavos: refundDueC, orderNumber: order.orderNumber, reason: "order edited" })).refundId;
      }
    }

    await tx
      .update(orders)
      .set({ subtotal: peso(subtotalC), discount: peso(discountC), tax: peso(taxC), serviceFee: peso(serviceFeeC), total: peso(newTotalC), editedAt: new Date() })
      .where(eq(orders.id, orderId));
    const summary = `Edited: ${changes.join(", ")}. Total ₱${peso(oldTotalC)} → ₱${peso(newTotalC)}${refundDueC ? ` (give back ₱${peso(refundDueC)})` : ""}`;
    await tx.insert(orderStatusHistory).values({
      orderId,
      status: order.status,
      event: "order_edited",
      note: summary.slice(0, 500),
      actorId: actor.userId,
    });
    await tx.insert(orderReturns).values({
      tenantId,
      orderId,
      kind: "edit",
      itemsJson: planned
        .filter((p) => (p.id ? byId.get(p.id)!.quantity !== p.qty : p.qty > 0))
        .map((p) => ({
          orderItemId: p.id ?? "new",
          variantId: p.variantId,
          title: p.title,
          qty: p.qty - (p.id ? byId.get(p.id)!.quantity : 0),
          unitPrice: p.unitC / 100,
          restock: true,
        })),
      refundAmount: peso(refundDueC),
      refundMethod: refundDueC ? (gatewayRefundId ? "original" : "shop") : "none",
      gatewayRefundId: gatewayRefundId ?? null,
      note: options.note?.slice(0, 300) ?? null,
      actorUserId: actor.userId,
      actorName: actor.name.slice(0, 80),
    });
    return {
      orderNumber: order.orderNumber,
      oldTotal: oldTotalC / 100,
      newTotal: newTotalC / 100,
      refundDue: refundDueC / 100,
      refundedAtGateway: Boolean(gatewayRefundId),
      summary,
    };
  });
}

// ─── Returns, exchanges, partial refunds ─────────────────────────────────────

export const REFUND_METHODS = ["original", "cash", "gcash", "maya", "bank", "card", "store_credit", "none"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export interface ReturnItemInput {
  orderItemId: string;
  qty: number;
  restock: boolean;
  /** Exchange: another variant of the same product handed to the buyer. */
  replacementVariantId?: string | null;
}

export interface ReturnInput {
  items: ReturnItemInput[];
  /** Pesos. May be 0 (exchange of same price) — capped at what's still refundable. */
  refundAmount: number;
  /** Pesos the buyer paid on top (exchange to a dearer size). */
  collectedAmount?: number;
  refundMethod: RefundMethod;
  note?: string | null;
  /** POS: the open shift this happens in (refund comes out of that drawer). */
  registerSessionId?: string | null;
}

export interface ReturnResult {
  returnId: string;
  orderNumber: string;
  refunded: number;
  fullyRefunded: boolean;
  restockedUnits: number;
  gatewayRefundId: string | null;
  summary: string;
  /** Phase 17: the store credit issued when refundMethod = store_credit. */
  storeCredit?: { code: string; amount: number } | null;
}

export async function recordReturn(
  tenantId: string,
  orderId: string,
  input: ReturnInput,
  actor: Actor,
  options: { refundAtGateway?: GatewayPartialRefund } = {}
): Promise<ReturnResult> {
  if (!(REFUND_METHODS as readonly string[]).includes(input.refundMethod)) throw new OrderError("Pick how the money goes back.", "INVALID_TRANSITION");
  const refundC = c(input.refundAmount);
  const collectedC = c(input.collectedAmount ?? 0);
  if (refundC < 0 || collectedC < 0) throw new OrderError("Amounts can't be negative.", "INVALID_TRANSITION");
  if (refundC > 0 && collectedC > 0) throw new OrderError("Either refund or collect a difference, not both.", "INVALID_TRANSITION");
  if (input.items.length === 0 && refundC === 0) throw new OrderError("Pick the items coming back, or enter a refund.", "INVALID_TRANSITION");
  if ((refundC > 0 || collectedC > 0) && input.refundMethod === "none") throw new OrderError("Pick how the money moves (cash, GCash…).", "INVALID_TRANSITION");

  const db = getDb();
  let applied: ApplyOrderActionResult | null = null;
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, tenantId, orderId);
    // Phase 17: the part paid by gift card / store credit goes back on the card (when the
    // order is fully refunded), so only the rest can be refunded as money.
    const giftC = c(order.giftCardAmount ?? 0);
    const refundableC = c(order.total) - giftC - c(order.refundedAmount);
    const blocked = returnBlocked(order, refundableC);
    if (blocked) throw new OrderError(blocked, "INVALID_TRANSITION");
    if (refundC > refundableC) throw new OrderError(`You can refund up to ₱${peso(refundableC)} on this order.`, "INVALID_TRANSITION");

    const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const byId = new Map(lines.map((l) => [l.id, l]));
    const items: OrderReturnItem[] = [];
    let restockedUnits = 0;
    const seen = new Set<string>();
    const note = `Return on ${order.orderNumber}`;
    for (const it of input.items) {
      const line = byId.get(it.orderItemId);
      if (!line) throw new OrderError("An item isn't on this order.", "INVALID_TRANSITION");
      if (seen.has(line.id)) throw new OrderError("An item is listed twice.", "INVALID_TRANSITION");
      seen.add(line.id);
      const qty = Math.trunc(Number(it.qty));
      const left = line.quantity - line.returnedQty;
      if (!Number.isFinite(qty) || qty < 1 || qty > left) {
        throw new OrderError(`"${line.titleSnapshot}": ${left} can still come back.`, "INVALID_TRANSITION");
      }
      let replacement: { id: string; title: string; price: number } | null = null;
      if (it.replacementVariantId) {
        const [rep] = await tx
          .select({ id: productVariants.id, title: productVariants.title, price: productVariants.price, productId: productVariants.productId, productTitle: products.title })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(and(eq(productVariants.id, it.replacementVariantId), eq(products.tenantId, tenantId), eq(productVariants.active, true)))
          .limit(1);
        if (!rep || rep.productId !== line.productId) throw new OrderError("Swap for a size/colour of the same product.", "INVALID_TRANSITION");
        if (rep.id === line.variantId) throw new OrderError("Pick a different size or colour to swap to.", "INVALID_TRANSITION");
        replacement = { id: rep.id, title: `${rep.productTitle} (${rep.title})`, price: Number(rep.price) };
        await moveStock(tx, { tenantId, orderId, variantId: rep.id, delta: -qty, reason: "exchange_out", actorId: actor.userId, note: `Exchange on ${order.orderNumber}`, locationId: order.locationId }, replacement.title);
      }
      if (it.restock && line.variantId) {
        await moveStock(tx, { tenantId, orderId, variantId: line.variantId, delta: qty, reason: "return_restock", actorId: actor.userId, note, locationId: order.locationId }, line.titleSnapshot);
        restockedUnits += qty;
      }
      await tx.update(orderItems).set({ returnedQty: line.returnedQty + qty }).where(eq(orderItems.id, line.id));
      items.push({
        orderItemId: line.id,
        variantId: line.variantId,
        title: line.titleSnapshot,
        qty,
        unitPrice: Number(line.unitPrice),
        restock: Boolean(it.restock && line.variantId),
        replacementVariantId: replacement?.id ?? null,
        replacementTitle: replacement?.title ?? null,
        replacementUnitPrice: replacement?.price ?? null,
      });
    }
    const kind = items.some((i) => i.replacementVariantId) ? "exchange" : "return";

    let gatewayRefundId: string | null = null;
    if (refundC > 0 && input.refundMethod === "original") {
      const [txn] = await tx
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "paid")))
        .orderBy(sql`${paymentTransactions.paidAt} desc nulls last`)
        .limit(1);
      if (txn?.gateway === "paymongo") {
        if (!txn.gatewayPaymentId || !options.refundAtGateway) {
          throw new OrderError("This order was paid online — online refunds aren't switched on yet. Choose cash/GCash/Maya/bank and send it yourself.", "INVALID_TRANSITION");
        }
        gatewayRefundId = (await options.refundAtGateway({ gatewayPaymentId: txn.gatewayPaymentId, amountCentavos: refundC, orderNumber: order.orderNumber, reason: "return" })).refundId ?? null;
      }
    }

    const refundedAfterC = c(order.refundedAmount) + refundC;
    await tx.update(orders).set({ refundedAmount: peso(refundedAfterC) }).where(eq(orders.id, orderId));

    // Phase 17: refund as store credit — a credit the buyer spends on a later order.
    let storeCredit: { code: string; amount: number } | null = null;
    if (refundC > 0 && input.refundMethod === "store_credit") {
      const card = await issueGiftCardInTx(tx, {
        tenantId,
        amount: refundC / 100,
        kind: "store_credit",
        customerId: order.customerRecordId,
        recipientName: order.guestName && order.guestName !== "Walk-in" ? order.guestName : null,
        note: `Return on ${order.orderNumber}`,
        createdByName: actor.name,
        orderId,
      });
      storeCredit = { code: card.code, amount: card.balance };
    }
    const [row] = await tx
      .insert(orderReturns)
      .values({
        tenantId,
        orderId,
        kind,
        itemsJson: items,
        refundAmount: peso(refundC),
        collectedAmount: peso(collectedC),
        // For a collected difference this is how the buyer paid it.
        refundMethod: refundC > 0 || collectedC > 0 ? input.refundMethod : "none",
        gatewayRefundId,
        note: input.note?.trim().slice(0, 300) || null,
        actorUserId: actor.userId,
        actorName: actor.name.slice(0, 80),
        posStaffId: actor.posStaffId ?? null,
        registerSessionId: input.registerSessionId ?? null,
      })
      .returning({ id: orderReturns.id });

    const what = items.map((i) => `${i.qty}× ${i.title}${i.replacementTitle ? ` → ${i.replacementTitle}` : ""}`).join(", ");
    const summary = `${kind === "exchange" ? "Exchange" : "Return"} on ${order.orderNumber}${what ? `: ${what}` : ""}${refundC ? ` · refunded ₱${peso(refundC)}${storeCredit ? ` as store credit ${storeCredit.code}` : ""}` : ""}${collectedC ? ` · collected ₱${peso(collectedC)}` : ""}`;
    await tx.insert(orderStatusHistory).values({ orderId, status: order.status, event: `order_${kind}`, note: summary.slice(0, 500), actorId: actor.userId });

    // Everything refunded → the order closes as refunded (normal state machine, no restock:
    // the goods were with the buyer and came back item by item above).
    const fullyRefunded = refundedAfterC >= c(order.total) - giftC && c(order.total) > 0;
    if (fullyRefunded) {
      applied = await applyOrderActionInTx(tx, {
        orderId,
        tenantId,
        action: { type: "refund" },
        source: "seller",
        actorId: actor.userId,
        note: "Fully refunded through returns",
        payment: { refundId: gatewayRefundId, viaRefundFlow: true },
      });
      // The gift-card part was put back on its card by the refund action.
      if (giftC > 0) await tx.update(orders).set({ refundedAmount: order.total }).where(eq(orders.id, orderId));
    }
    return { returnId: row!.id, orderNumber: order.orderNumber, refunded: refundC / 100, fullyRefunded, restockedUnits, gatewayRefundId, summary, storeCredit };
  });
  if (applied) await applyWalletEffects(applied);
  return result;
}

// ─── POS void ────────────────────────────────────────────────────────────────

export interface VoidResult {
  orderNumber: string;
  total: number;
  summary: string;
}

/**
 * Reverses a POS sale in the shift it was rung up in: stock back, the sale drops out
 * of the drawer's expected totals (cancelled orders aren't counted), and a "void" row
 * keeps the record for X/Z readings.
 */
export async function voidPosSale(
  tenantId: string,
  orderId: string,
  input: { openShiftId: string; reason: string },
  actor: Actor
): Promise<VoidResult> {
  const reason = input.reason.trim().slice(0, 200);
  if (!reason) throw new OrderError("Say why the sale is voided.", "INVALID_TRANSITION");
  const db = getDb();
  let applied: ApplyOrderActionResult | null = null;
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, tenantId, orderId);
    if (order.sourceChannel !== "pos") throw new OrderError("Only POS sales can be voided.", "INVALID_TRANSITION");
    if (order.voidedAt) throw new OrderError("This sale was already voided.", "INVALID_TRANSITION");
    if (order.registerSessionId !== input.openShiftId) {
      throw new OrderError("Only sales from the current shift can be voided. Use a return instead.", "INVALID_TRANSITION");
    }
    const [ret] = await tx.select({ id: orderReturns.id }).from(orderReturns).where(eq(orderReturns.orderId, orderId)).limit(1);
    if (ret) throw new OrderError("This sale already has a return — it can't be voided.", "INVALID_TRANSITION");

    await restockOrderInTx(tx, orderId, "restock_cancel", actor.userId);
    await restoreGiftCardsForOrderInTx(tx, { tenantId, orderId, actorName: actor.name || "Cashier", note: "POS sale voided — balance put back" });
    applied = await applyOrderActionInTx(tx, {
      orderId,
      tenantId,
      action: { type: "refund" },
      source: "seller",
      actorId: actor.userId,
      note: `Voided by ${actor.name}: ${reason}`,
      payment: { viaRefundFlow: true },
    });
    await tx.update(orders).set({ voidedAt: new Date(), refundedAmount: order.total }).where(eq(orders.id, orderId));
    const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    await tx.insert(orderReturns).values({
      tenantId,
      orderId,
      kind: "void",
      itemsJson: lines.map((l) => ({ orderItemId: l.id, variantId: l.variantId, title: l.titleSnapshot, qty: l.quantity, unitPrice: Number(l.unitPrice), restock: true })),
      refundAmount: order.total,
      refundMethod: "original",
      note: reason,
      actorUserId: actor.userId,
      actorName: actor.name.slice(0, 80),
      posStaffId: actor.posStaffId ?? null,
      registerSessionId: input.openShiftId,
    });
    return { orderNumber: order.orderNumber, total: Number(order.total), summary: `Voided POS sale ${order.orderNumber} (₱${Number(order.total).toFixed(2)}): ${reason}` };
  });
  if (applied) await applyWalletEffects(applied);
  return result;
}

/** Refunds made from a shift's drawer (POS returns), by method — for the shift summary. */
export async function shiftRefundsByMethod(tenantId: string, shiftId: string): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ method: orderReturns.refundMethod, amount: sql<string>`sum(${orderReturns.refundAmount})`, collected: sql<string>`sum(${orderReturns.collectedAmount})` })
    .from(orderReturns)
    .where(and(eq(orderReturns.tenantId, tenantId), eq(orderReturns.registerSessionId, shiftId), inArray(orderReturns.kind, ["return", "exchange"])))
    .groupBy(orderReturns.refundMethod);
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.method] = Math.round((Number(r.amount ?? 0) - Number(r.collected ?? 0)) * 100) / 100;
  }
  return out;
}
