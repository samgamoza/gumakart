import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  gatewayRefunds,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  stockMovements,
  tenants,
} from "../schema/index";
import {
  creditSaleForOrder,
  releaseOrderSaleCredit,
  reverseSaleCreditForOrder,
} from "./wallet";
import { OrderError } from "./order-status";
import { restoreGiftCardsForOrderInTx } from "./gift-cards";
import { recordStockMovement } from "./stock-ledger";
import { insertOutboxEvent } from "./outbox";
import {
  describeStates,
  invariantViolation,
  legacyPaymentStatusOf,
  legacyStatusOf,
  planOrderAction,
  type ActionSource,
  type FulfillmentState,
  type OrderAction,
  type OrderFacts,
  type OrderState,
  type PaymentState,
} from "./order-state";

/**
 * The order service — the one place an order changes after checkout
 * (docs/PHASE-2-MIGRATION-SPEC.md §2.2).
 *
 * applyOrderAction() runs one transaction that:
 *   1. row-locks the order (SELECT … FOR UPDATE),
 *   2. asks the pure state machine (order-state.ts) whether the action is allowed,
 *   3. writes the three new statuses AND the legacy status/payment_status
 *      (dual-write until migration 0024),
 *   4. updates the order's payment row, restocks exactly once when needed,
 *   5. writes order_status_history and an outbox event.
 * Wallet side effects run right after commit; they're idempotent.
 *
 * Callers: seller (admin order actions), buyer (payment proof), courier
 * (Lalamove/Grab/BayanGo webhooks), gateway (PayMongo webhook), system
 * (unpaid expiry).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type OrderRow = typeof orders.$inferSelect;

export type { ActionSource, OrderAction, OrderFacts } from "./order-state";

export interface ApplyOrderActionInput {
  orderId: string;
  /** Required for seller actions: scopes the lock to the seller's shop. */
  tenantId?: string;
  action: OrderAction;
  source: ActionSource;
  actorId?: string | null;
  note?: string;
  cancelReason?: string;
  /** Payment-row details for payment actions. */
  payment?: {
    reference?: string | null;
    proofUrl?: string | null;
    gatewayPaymentId?: string | null;
    refundId?: string | null;
    /** The caller already updated the payment row (e.g. the PayMongo webhook). */
    rowHandled?: boolean;
    /** Set only by refundOrder(), which handles the gateway call and locking. */
    viaRefundFlow?: boolean;
  };
}

export interface ApplyOrderActionResult {
  changed: boolean;
  orderId: string;
  orderNumber: string;
  tenantId: string;
  total: string;
  paymentMethod: string;
  before: OrderFacts;
  after: OrderFacts;
  restocked: boolean;
  codCollected: boolean;
  /** A courier booking is live and has to be cancelled with the provider. */
  cancelCourierBooking: boolean;
}

// ─── Reading the current facts ──────────────────────────────────────────────

/** Rows written before migration 0022 have no states yet — derive them like the back-fill does. */
function factsFromLegacy(row: OrderRow): OrderFacts {
  const status = row.status;
  const cod = row.paymentMethod === "cod";
  const paymentState: PaymentState =
    status === "refunded" || row.paymentStatus === "refunded"
      ? "refunded"
      : status === "delivered" || row.paymentStatus === "paid"
        ? "paid"
        : row.paymentStatus === "failed"
          ? "failed"
          : status === "cancelled"
            ? "unpaid"
            : cod
              ? "cod_due"
              : "unpaid";
  const fulfillmentState: FulfillmentState =
    status === "ready_for_pickup"
      ? "ready"
      : status === "out_for_delivery"
        ? "out_for_delivery"
        : status === "delivered"
          ? "delivered"
          : "unfulfilled";
  const orderState: OrderState =
    status === "cancelled" || status === "refunded" ? "cancelled" : status === "delivered" ? "completed" : "open";
  return {
    orderState,
    paymentState,
    fulfillmentState,
    accepted: ["accepted", "preparing", "ready_for_pickup", "out_for_delivery", "delivered"].includes(status),
    paymentMethod: row.paymentMethod ?? "",
  };
}

export function factsOf(row: OrderRow): OrderFacts {
  if (!row.orderState || !row.paymentState || !row.fulfillmentState) return factsFromLegacy(row);
  return {
    orderState: row.orderState,
    paymentState: row.paymentState,
    fulfillmentState: row.fulfillmentState,
    accepted: row.acceptedAt != null,
    paymentMethod: row.paymentMethod ?? "",
  };
}

async function lockOrder(tx: Tx, orderId: string, tenantId?: string): Promise<OrderRow | null> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(tenantId ? and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)) : eq(orders.id, orderId))
    .limit(1)
    .for("update");
  return order ?? null;
}

// ─── Stock ──────────────────────────────────────────────────────────────────

export type RestockReason = "restock_cancel" | "restock_refund" | "restock_expiry";

/**
 * Puts reserved stock back, exactly once per order (claims stock_restored_at).
 * Mirrors the checkout decrement: only variants of products that track inventory.
 */
export async function restockOrderInTx(
  tx: Tx,
  orderId: string,
  reason: RestockReason = "restock_cancel",
  actorId?: string | null
): Promise<boolean> {
  const [claimed] = await tx
    .update(orders)
    .set({ stockRestoredAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.stockRestoredAt)))
    .returning({ id: orders.id, tenantId: orders.tenantId, locationId: orders.locationId });
  if (!claimed) return false;

  // Security G2 (GK-14): put back what was actually TAKEN for this order, not
  // what was ordered. The stock ledger knows: every decrement for the order
  // (sale, edit, exchange) and every unit already returned carry its id.
  // Pre-orders, short offline sales and item-by-item returns therefore never
  // inflate stock.
  const taken = await tx
    .select({
      variantId: stockMovements.variantId,
      net: sql<number>`-sum(${stockMovements.delta})`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.orderId, orderId), sql`${stockMovements.reason} not in ('restock_cancel', 'restock_refund', 'restock_expiry')`))
    .groupBy(stockMovements.variantId);

  const qtyByVariant = new Map<string, number>();
  if (taken.length > 0) {
    for (const row of taken) {
      const n = Number(row.net);
      if (row.variantId && n > 0) qtyByVariant.set(row.variantId, n);
    }
  } else {
    // Orders older than the stock ledger: fall back to the lines, minus what came back.
    const lines = await tx
      .select({
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
        returnedQty: orderItems.returnedQty,
        trackInventory: products.trackInventory,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId));
    for (const line of lines) {
      if (!line.variantId || !line.trackInventory) continue;
      const left = Math.max(0, line.quantity - (line.returnedQty ?? 0));
      if (left > 0) qtyByVariant.set(line.variantId, (qtyByVariant.get(line.variantId) ?? 0) + left);
    }
  }

  for (const [variantId, quantity] of qtyByVariant) {
    const [updated] = await tx
      .update(productVariants)
      .set({ stockQty: sql`coalesce(${productVariants.stockQty}, 0) + ${quantity}` })
      .where(eq(productVariants.id, variantId))
      .returning({ stockQty: productVariants.stockQty });
    if (!updated) continue; // variant deleted since the sale
    await recordStockMovement(tx, {
      tenantId: claimed.tenantId,
      variantId,
      orderId,
      reason,
      delta: quantity,
      balanceAfter: updated.stockQty,
      actorId,
      locationId: claimed.locationId,
    });
  }
  return true;
}

// ─── Events ─────────────────────────────────────────────────────────────────

const FULFILLMENT_EVENT: Record<FulfillmentState, string> = {
  unfulfilled: "Fulfillment.Reset.V1",
  ready: "Fulfillment.Ready.V1",
  booked: "Fulfillment.Booked.V1",
  picked_up: "Fulfillment.PickedUp.V1",
  out_for_delivery: "Fulfillment.OutForDelivery.V1",
  delivered: "Fulfillment.Delivered.V1",
  failed_delivery: "Fulfillment.Failed.V1",
  returned: "Fulfillment.Returned.V1",
};

function eventNameFor(action: OrderAction): string {
  switch (action.type) {
    case "submit_payment_proof":
      return "Order.PaymentSubmitted.V1";
    case "confirm_payment":
      return "Order.PaymentConfirmed.V1";
    case "reject_payment_proof":
      return "Order.PaymentRejected.V1";
    case "accept":
      return "Order.Accepted.V1";
    case "mark_ready":
      return "Fulfillment.Ready.V1";
    case "fulfillment_update":
      return FULFILLMENT_EVENT[action.to];
    case "booking_cancelled":
      return "Fulfillment.BookingCancelled.V1";
    case "cancel":
      return "Order.Cancelled.V1";
    case "expire":
      return "Order.Expired.V1";
    case "refund":
      return "Order.Refunded.V1";
  }
}

function historyEventFor(action: OrderAction): string {
  return action.type === "fulfillment_update" ? `fulfillment_${action.to}` : action.type;
}

function defaultNote(action: OrderAction, source: ActionSource, codCollected: boolean): string | undefined {
  if (codCollected) return "Delivered — COD collected";
  switch (action.type) {
    case "expire":
      return "Not paid in time — cancelled and stock released";
    case "cancel":
      return source === "seller" ? "Cancelled by seller" : "Cancelled";
    case "confirm_payment":
      return source === "gateway" ? "Payment confirmed via PayMongo" : "Payment confirmed by seller";
    case "submit_payment_proof":
      return "Buyer sent payment details";
    case "reject_payment_proof":
      return "Payment not received — buyer asked to pay again";
    case "booking_cancelled":
      return "Courier booking was cancelled — rebook the delivery";
    default:
      return undefined;
  }
}

// ─── Payment row side effects ───────────────────────────────────────────────

async function liveChargeRow(tx: Tx, orderId: string) {
  const [row] = await tx
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.orderId, orderId),
        inArray(paymentTransactions.status, ["pending", "processing", "failed", "paid"])
      )
    )
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(1)
    .for("update");
  return row ?? null;
}

async function applyPaymentRow(
  tx: Tx,
  order: OrderRow,
  input: ApplyOrderActionInput,
  codCollected: boolean,
  now: Date
): Promise<void> {
  if (input.payment?.rowHandled) return;
  const type = input.action.type;
  if (!codCollected && !["confirm_payment", "submit_payment_proof", "reject_payment_proof", "refund"].includes(type)) {
    return;
  }

  if (type === "refund") {
    await tx
      .update(paymentTransactions)
      .set({ status: "refunded", refundedAt: now, refundId: input.payment?.refundId ?? null })
      .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "paid")));
    return;
  }

  const live = await liveChargeRow(tx, order.id);
  const isCod = order.paymentMethod === "cod";

  if (type === "submit_payment_proof") {
    const fields = {
      status: "processing" as const,
      reference: input.payment?.reference ?? live?.reference ?? null,
      proofUrl: input.payment?.proofUrl ?? live?.proofUrl ?? null,
      failureReason: null,
    };
    if (live) {
      await tx.update(paymentTransactions).set(fields).where(eq(paymentTransactions.id, live.id));
    } else {
      await tx.insert(paymentTransactions).values({
        orderId: order.id,
        tenantId: order.tenantId,
        gateway: "manual",
        gatewayIntentId: `manual_${order.id}`,
        amount: order.total,
        methodType: order.paymentMethod,
        ...fields,
      });
    }
    return;
  }

  if (type === "reject_payment_proof") {
    if (live) {
      await tx
        .update(paymentTransactions)
        .set({ status: "pending", failureReason: "Seller didn't receive this payment" })
        .where(eq(paymentTransactions.id, live.id));
    }
    return;
  }

  // confirm_payment, or COD collected on delivery.
  const paidFields = {
    status: "paid" as const,
    paidAt: now,
    ...(input.payment?.gatewayPaymentId ? { gatewayPaymentId: input.payment.gatewayPaymentId } : {}),
    ...(input.source === "seller" ? { verifiedBy: input.actorId ?? null, verifiedAt: now } : {}),
  };
  if (live && live.status !== "paid") {
    await tx.update(paymentTransactions).set(paidFields).where(eq(paymentTransactions.id, live.id));
  } else if (!live) {
    await tx
      .insert(paymentTransactions)
      .values({
        orderId: order.id,
        tenantId: order.tenantId,
        gateway: isCod ? "cod" : "manual",
        gatewayIntentId: `${isCod ? "cod" : "manual"}_${order.id}`,
        amount: order.total,
        methodType: order.paymentMethod,
        rawWebhookJson: codCollected ? { collectedVia: input.source } : null,
        ...paidFields,
      })
      .onConflictDoNothing({ target: paymentTransactions.gatewayIntentId });
  }
}

// ─── The service ────────────────────────────────────────────────────────────

/** Applies an action inside the caller's transaction. Wallet effects are the caller's job (see applyOrderAction). */
export async function applyOrderActionInTx(
  tx: Tx,
  input: ApplyOrderActionInput
): Promise<ApplyOrderActionResult> {
  if (input.source === "seller" && !input.tenantId) {
    throw new Error("applyOrderAction: seller actions must be tenant-scoped.");
  }
  if (input.action.type === "refund" && !input.payment?.viaRefundFlow) {
    throw new OrderError("Use “Refund” so the money goes back to the buyer.", "INVALID_TRANSITION");
  }
  const order = await lockOrder(tx, input.orderId, input.tenantId);
  if (!order) throw new OrderError("Order not found.", "ORDER_NOT_FOUND");

  const before = factsOf(order);
  const plan = planOrderAction(before, input.action, input.source);
  if (!plan.ok) throw new OrderError(plan.reason, "INVALID_TRANSITION");

  const base = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    tenantId: order.tenantId,
    total: order.total,
    paymentMethod: order.paymentMethod ?? "",
    before,
  };
  if (!plan.changed) {
    return { ...base, changed: false, after: before, restocked: false, codCollected: false, cancelCourierBooking: false };
  }

  const after = plan.next;
  const broken = invariantViolation(after);
  if (broken) throw new Error(`Order state invariant broken (${broken}) — refusing to save.`);

  const now = new Date();
  const becamePaid = after.paymentState === "paid" && before.paymentState !== "paid";
  const becameDelivered = after.fulfillmentState === "delivered" && before.fulfillmentState !== "delivered";
  const becameCancelled = after.orderState === "cancelled" && before.orderState !== "cancelled";

  await tx
    .update(orders)
    .set({
      orderState: after.orderState,
      paymentState: after.paymentState,
      fulfillmentState: after.fulfillmentState,
      ...(after.accepted && !order.acceptedAt ? { acceptedAt: now } : {}),
      ...(becamePaid ? { paidAt: order.paidAt ?? now } : {}),
      ...(becameDelivered || (after.orderState === "completed" && !order.completedAt) ? { completedAt: now } : {}),
      ...(becameCancelled
        ? { cancelledAt: now, cancelReason: input.cancelReason?.slice(0, 200) ?? null }
        : {}),
      // Dual-write: legacy readers keep working until 0024 drops these.
      status: legacyStatusOf(after),
      paymentStatus: legacyPaymentStatusOf(after.paymentState),
    })
    .where(eq(orders.id, order.id));

  await applyPaymentRow(tx, order, input, plan.codCollected, now);

  let restocked = false;
  if (plan.restock) {
    const reason: RestockReason =
      input.action.type === "expire"
        ? "restock_expiry"
        : input.action.type === "refund"
          ? "restock_refund"
          : "restock_cancel";
    restocked = await restockOrderInTx(tx, order.id, reason, input.actorId);
  }

  // Phase 17: a cancelled / expired / fully refunded order gives back what it took from
  // gift cards or store credit (once — restoreGiftCardsForOrderInTx is idempotent).
  if (after.orderState === "cancelled" || input.action.type === "refund") {
    await restoreGiftCardsForOrderInTx(tx, {
      tenantId: order.tenantId,
      orderId: order.id,
      actorName: input.source === "seller" ? "Seller" : "Guma Kart",
      note: input.action.type === "refund" ? "Order refunded — balance put back" : "Order cancelled — balance put back",
    });
  }

  let note = input.note ?? defaultNote(input.action, input.source, plan.codCollected);
  if (plan.cancelCourierBooking) {
    note = `${note ? `${note}. ` : ""}A rider was booked — cancel it with the courier too.`;
  }

  const [history] = await tx
    .insert(orderStatusHistory)
    .values({
      orderId: order.id,
      status: legacyStatusOf(after),
      event: historyEventFor(input.action),
      fromState: describeStates(before),
      toState: describeStates(after),
      note,
      actorId: input.actorId ?? null,
    })
    .returning({ id: orderStatusHistory.id });

  const eventData = {
    tenantId: order.tenantId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: input.source,
    orderState: after.orderState,
    paymentState: after.paymentState,
    fulfillmentState: after.fulfillmentState,
    paymentMethod: order.paymentMethod,
    total: order.total,
    codCollected: plan.codCollected,
  };
  const eventName = eventNameFor(input.action);
  await insertOutboxEvent(tx, {
    name: eventName,
    tenantId: order.tenantId,
    idempotencyKey: `${eventName}:${order.id}:${history!.id}`,
    data: eventData,
  });
  if (after.orderState === "completed" && before.orderState !== "completed") {
    await insertOutboxEvent(tx, {
      name: "Order.Completed.V1",
      tenantId: order.tenantId,
      idempotencyKey: `Order.Completed.V1:${order.id}`,
      data: eventData,
    });
  }

  return {
    ...base,
    changed: true,
    after,
    restocked,
    codCollected: plan.codCollected,
    cancelCourierBooking: plan.cancelCourierBooking,
  };
}

/** Wallet effects after commit. All idempotent (unique ledger entries). */
export async function applyWalletEffects(result: ApplyOrderActionResult): Promise<void> {
  if (!result.changed) return;
  const { before, after } = result;
  const becamePaid = after.paymentState === "paid" && before.paymentState !== "paid";
  const becameDelivered = after.fulfillmentState === "delivered" && before.fulfillmentState !== "delivered";

  if (after.paymentState === "refunded" && before.paymentState !== "refunded") {
    await reverseSaleCreditForOrder(result.orderId);
    return;
  }
  if (becamePaid) {
    // Cash in hand (COD) or goods already delivered → money is available now.
    await creditSaleForOrder(result.orderId, {
      immediateAvailable: result.codCollected || after.fulfillmentState === "delivered",
    });
    return;
  }
  if (becameDelivered && after.paymentState === "paid") {
    await releaseOrderSaleCredit(result.orderId);
  }
}

export async function applyOrderAction(input: ApplyOrderActionInput): Promise<ApplyOrderActionResult> {
  const db = getDb();
  const result = await db.transaction((tx) => applyOrderActionInTx(tx, input));
  await applyWalletEffects(result);
  return result;
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

export interface GatewayRefundRequest {
  gateway: string;
  gatewayPaymentId: string | null;
  totalCentavos: number;
  orderNumber: string;
  /** Security G2: the gateway_refunds row id — pass it to the gateway as the idempotency key where supported. */
  refundRowId?: string;
}

export interface RefundOrderResult {
  gateway: string;
  refundId?: string;
  restocked: boolean;
  /** True for manual/COD: the seller returns the money directly to the buyer. */
  refundedOutsidePlatform: boolean;
  /** Security G2: the gateway refund was recorded but could not be sent; retry it (POST …/refunds/:id/retry). */
  gatewayRefundPending?: { refundRowId: string; error: string };
}

const LOCK_NOT_AVAILABLE = "55P03";

/**
 * Security G2 (GK-13): record a gateway refund inside the order's transaction.
 * The money is NOT sent here. One row per refund (unique per order for a full
 * refund, per return row for a partial one), so a rolled-back transaction or a
 * repeated request can never pay the buyer twice: the send happens after
 * commit, through settleGatewayRefund(), against that one row.
 */
export async function recordGatewayRefundInTx(
  tx: Tx,
  input: { tenantId: string; orderId: string; kind: "full" | "partial" | "edit"; gateway: "paymongo" | "xendit"; gatewayPaymentId: string; amountCentavos: number; returnId?: string | null }
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(gatewayRefunds)
    .values({
      tenantId: input.tenantId,
      orderId: input.orderId,
      returnId: input.returnId ?? null,
      kind: input.kind,
      gateway: input.gateway,
      gatewayPaymentId: input.gatewayPaymentId,
      amount: (input.amountCentavos / 100).toFixed(2),
      status: "pending",
    })
    .returning({ id: gatewayRefunds.id });
  return row!;
}

/**
 * Sends one recorded gateway refund. Claims the row (pending/failed → processing)
 * first, so two callers can't both send it; records the gateway's refund id or
 * the error. Safe to call again for a failed row (that is the retry).
 */
export async function settleGatewayRefund(
  refundRowId: string,
  refundAtGateway: (request: GatewayRefundRequest) => Promise<{ refundId?: string }>
): Promise<{ ok: true; refundId?: string } | { ok: false; error: string }> {
  const db = getDb();
  const [claimed] = await db
    .update(gatewayRefunds)
    .set({ status: "processing", attempts: sql`${gatewayRefunds.attempts} + 1` })
    .where(and(eq(gatewayRefunds.id, refundRowId), inArray(gatewayRefunds.status, ["pending", "failed"])))
    .returning();
  if (!claimed) {
    const [row] = await db.select().from(gatewayRefunds).where(eq(gatewayRefunds.id, refundRowId)).limit(1);
    if (row?.status === "sent") return { ok: true, refundId: row.gatewayRefundId ?? undefined };
    return { ok: false, error: "This refund is already being sent." };
  }
  const [order] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, claimed.orderId)).limit(1);
  try {
    const res = await refundAtGateway({
      gateway: claimed.gateway,
      gatewayPaymentId: claimed.gatewayPaymentId,
      totalCentavos: Math.round(Number(claimed.amount) * 100),
      orderNumber: order?.orderNumber ?? "",
      refundRowId: claimed.id,
    });
    const now = new Date();
    await db
      .update(gatewayRefunds)
      .set({ status: "sent", gatewayRefundId: res.refundId ?? null, sentAt: now, error: null })
      .where(eq(gatewayRefunds.id, claimed.id));
    if (res.refundId) {
      await db
        .update(paymentTransactions)
        .set({ refundId: res.refundId, ...(claimed.kind === "full" ? { refundedAt: now } : {}) })
        .where(and(eq(paymentTransactions.orderId, claimed.orderId), eq(paymentTransactions.gatewayPaymentId, claimed.gatewayPaymentId)));
    }
    return { ok: true, refundId: res.refundId };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await db.update(gatewayRefunds).set({ status: "failed", error: message }).where(eq(gatewayRefunds.id, claimed.id));
    return { ok: false, error: message };
  }
}

/** Gateway refunds for an order that still need sending (for the order page / retry). */
export async function listPendingGatewayRefunds(tenantId: string, orderId: string) {
  const db = getDb();
  return db
    .select({ id: gatewayRefunds.id, kind: gatewayRefunds.kind, amount: gatewayRefunds.amount, status: gatewayRefunds.status, error: gatewayRefunds.error, attempts: gatewayRefunds.attempts, createdAt: gatewayRefunds.createdAt })
    .from(gatewayRefunds)
    .where(and(eq(gatewayRefunds.tenantId, tenantId), eq(gatewayRefunds.orderId, orderId), inArray(gatewayRefunds.status, ["pending", "processing", "failed"])))
    .orderBy(gatewayRefunds.createdAt);
}

/**
 * Refunds a paid order exactly once.
 *
 * The order row is locked with NOWAIT for the whole operation, so a second
 * click (or a retry while the first is running) fails fast. Security G2: the
 * gateway refund is recorded inside the transaction and SENT after commit —
 * a transaction that rolls back leaves no money moved, and a retry finds the
 * recorded row instead of refunding again.
 */
export async function refundOrder(params: {
  tenantId: string;
  orderId: string;
  actorId?: string;
  note?: string;
  refundAtGateway?: (request: GatewayRefundRequest) => Promise<{ refundId?: string }>;
}): Promise<RefundOrderResult> {
  const db = getDb();

  try {
    const { refund, applied, refundRowId } = await db.transaction(async (tx) => {
      // Raw SQL on purpose: drizzle 0.38 renders `{ noWait: true }` as the
      // invalid "for update no wait".
      await tx.execute(
        sql`select 1 from ${orders} where ${orders.id} = ${params.orderId} and ${orders.tenantId} = ${params.tenantId} for update nowait`
      );
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, params.orderId), eq(orders.tenantId, params.tenantId)))
        .limit(1);
      if (!order) throw new OrderError("Order not found.", "ORDER_NOT_FOUND");
      // Phase 13: marketplace orders are refunded on Shopee/Lazada (cancellations sync here).
      if (order.sourceChannel === "marketplace") {
        throw new OrderError("Refund this order in Shopee/Lazada — the cancellation syncs here and restocks.", "INVALID_TRANSITION");
      }

      // Check the rules BEFORE any money moves.
      const plan = planOrderAction(factsOf(order), { type: "refund" }, "seller");
      if (!plan.ok) throw new OrderError(plan.reason, "INVALID_TRANSITION");

      const [txn] = await tx
        .select()
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "paid")))
        .orderBy(sql`${paymentTransactions.paidAt} desc nulls last`)
        .limit(1);

      const gateway = txn?.gateway ?? (order.paymentMethod === "cod" ? "cod" : "manual");
      const refundedOutsidePlatform = gateway !== "paymongo" && gateway !== "xendit";

      let refundRowId: string | undefined;
      if (!refundedOutsidePlatform) {
        if (!txn?.gatewayPaymentId) {
          throw new OrderError(
            "PayMongo payment id is missing for this order — refund it from the PayMongo dashboard.",
            "INVALID_TRANSITION"
          );
        }
        if (!params.refundAtGateway) {
          throw new Error("refundOrder: refundAtGateway is required for PayMongo payments.");
        }
        // Phase 11: only what's left after partial refunds (returns).
        // Phase 17: the gift-card part goes back on the card, not through the gateway.
        const amountCentavos = Math.max(0, Math.round(Number(order.total) * 100) - Math.round(Number(order.giftCardAmount ?? 0) * 100) - Math.round(Number(order.refundedAmount ?? 0) * 100));
        if (amountCentavos > 0) {
          refundRowId = (await recordGatewayRefundInTx(tx, { tenantId: params.tenantId, orderId: order.id, kind: "full", gateway: gateway as "paymongo" | "xendit", gatewayPaymentId: txn.gatewayPaymentId, amountCentavos })).id;
        }
      }

      const baseNote =
        params.note ??
        (refundedOutsidePlatform
          ? "Refunded by seller — money returned to the buyer directly"
          : "Refund issued via PayMongo");
      const applied = await applyOrderActionInTx(tx, {
        orderId: order.id,
        tenantId: params.tenantId,
        action: { type: "refund" },
        source: "seller",
        actorId: params.actorId,
        note: baseNote,
        payment: { refundId: null, viaRefundFlow: true },
      });
      await tx.update(orders).set({ refundedAmount: order.total }).where(eq(orders.id, order.id));
      return {
        applied,
        refundRowId,
        refund: { gateway, restocked: applied.restocked, refundedOutsidePlatform } as RefundOrderResult,
      };
    });

    await applyWalletEffects(applied);
    if (refundRowId && params.refundAtGateway) {
      const sent = await settleGatewayRefund(refundRowId, params.refundAtGateway);
      if (sent.ok) refund.refundId = sent.refundId;
      else refund.gatewayRefundPending = { refundRowId, error: sent.error };
    }
    return refund;
  } catch (error) {
    // postgres-js puts the SQLSTATE on `code`; newer drizzle wraps it in `cause`.
    const e = error as { code?: string; cause?: { code?: string } } | null;
    if (e?.code === LOCK_NOT_AVAILABLE || e?.cause?.code === LOCK_NOT_AVAILABLE) {
      throw new OrderError(
        "A refund for this order is already in progress. Refresh in a moment.",
        "INVALID_TRANSITION"
      );
    }
    const dup = error as { code?: string; cause?: { code?: string; constraint_name?: string } } | null;
    if (dup?.code === "23505" || dup?.cause?.code === "23505") {
      throw new OrderError("A gateway refund for this order was already recorded. Check the order's refunds before trying again.", "INVALID_TRANSITION");
    }
    throw error;
  }
}

// ─── Unpaid order expiry ─────────────────────────────────────────────────────

export const DEFAULT_UNPAID_EXPIRY_HOURS = 24;
export const MIN_UNPAID_EXPIRY_HOURS = 1;
export const MAX_UNPAID_EXPIRY_HOURS = 72;

/**
 * Cancels orders still unpaid after the shop's window (settings
 * `checkout.unpaidExpiryHours`, 1–72, default 24 — decision D4) and puts the
 * stock back. Orders where the buyer already sent payment details
 * (pending_verification) wait for the seller.
 *
 * `olderThanHours` overrides every shop's setting (tests / manual runs).
 */
export async function expireUnpaidOrders(options: {
  olderThanHours?: number;
  defaultHours?: number;
  limit?: number;
} = {}): Promise<{ expired: number; orderIds: string[] }> {
  const db = getDb();
  const fallback = options.defaultHours ?? DEFAULT_UNPAID_EXPIRY_HOURS;
  const shopHours = sql<number>`least(${MAX_UNPAID_EXPIRY_HOURS}, greatest(${MIN_UNPAID_EXPIRY_HOURS},
    case when (${tenants.settingsJson} -> 'checkout' ->> 'unpaidExpiryHours') ~ '^[0-9]{1,3}$'
      then (${tenants.settingsJson} -> 'checkout' ->> 'unpaidExpiryHours')::int
      else ${fallback} end))`;
  const hoursExpr =
    options.olderThanHours !== undefined ? sql<number>`${options.olderThanHours}` : shopHours;

  const candidates = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(
      and(
        eq(orders.orderState, "open"),
        eq(orders.paymentState, "unpaid"),
        eq(orders.fulfillmentState, "unfulfilled"),
        lt(orders.createdAt, sql`now() - make_interval(hours => (${hoursExpr})::int)`)
      )
    )
    .orderBy(orders.createdAt)
    .limit(options.limit ?? 200);

  const expiredIds: string[] = [];
  for (const candidate of candidates) {
    try {
      const result = await applyOrderAction({
        orderId: candidate.id,
        action: { type: "expire" },
        source: "system",
      });
      if (result.changed) expiredIds.push(candidate.id);
    } catch (error) {
      // Changed between the scan and the lock — skip it.
      if (!(error instanceof OrderError)) throw error;
    }
  }
  return { expired: expiredIds.length, orderIds: expiredIds };
}
