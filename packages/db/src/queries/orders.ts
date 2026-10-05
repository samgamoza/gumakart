import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "../client";
import { recordStockMovement } from "./stock-ledger";
import { insertOutboxEvent } from "./outbox";
import { getDefaultLocationId } from "./locations";
import {
  describeStates,
  legacyStatusOf,
  orderBucketOf,
  type FulfillmentState,
  type OrderBucket,
  type OrderState,
  type PaymentState,
} from "./order-state";
import { applyOrderActionInTx, applyWalletEffects, factsOf } from "./order-lifecycle";
import {
  checkoutLinks,
  customers,
  deliveries,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  tenants,
} from "../schema/index";
import {
  computeCheckoutTotals,
  findActiveCoupon,
  normalizeCheckoutJson,
  type TenantCheckoutJson,
} from "../types/tenant-checkout";
import {
  isTenantAcceptingOrders,
  TENANT_SUSPENDED_BUYER_MESSAGE,
} from "../tenant-access";

export { ORDER_STATUS_TRANSITIONS, OrderError, type OrderStatus } from "./order-status";
import { OrderError, type OrderStatus } from "./order-status";

function toCentavos(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function fromCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

function orderNumberPrefix(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ORD";
}

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  /** Phase 9: required when the product has more than one active variant. */
  variantId?: string | null;
}

export interface CreateOrderInput {
  tenantSlug: string;
  items: CreateOrderItemInput[];
  customer: { name: string; phone: string; email?: string };
  deliveryType: "delivery" | "pickup";
  deliveryAddress?: {
    line1: string;
    line2?: string;
    city?: string;
    barangay?: string;
    province?: string;
    postalCode?: string;
    notes?: string;
  };
  paymentMethod: string;
  /** Delivery fee in PHP, already resolved by the caller from tenant settings. */
  deliveryFee: number;
  /** Minimum order amount in PHP; 0 disables the check. */
  minOrderAmount: number;
  /** Published checkout config for tax / coupon / automatic discount. */
  checkoutConfig?: import("../types/tenant-checkout").TenantCheckoutJson | null;
  couponCode?: string | null;
  notes?: string;
  sourceChannel?: string;
  /** Buyer ticked "send me reminders about this order" (marketing SMS consent). */
  smsMarketingConsent?: boolean;
  /**
   * Phase 3: the checkout link this order came through. Its order counter is
   * bumped in the same transaction, and the order is refused if the link was
   * turned off, ended, or reached its order limit in the meantime.
   */
  checkoutLinkId?: string | null;
  /** utm_source / utm_medium / utm_campaign / utm_content (+ fbclid etc.), already sanitized. */
  utmJson?: Record<string, string> | null;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  tenantId: string;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  tax: string;
  deliveryFee: string;
  total: string;
  totalCentavos: number;
  couponCode: string | null;
  /** Secret for the buyer's order link (?t=…). Never log it. */
  accessToken: string;
  items: Array<{ title: string; quantity: number; unitPrice: string; lineTotal: string }>;
}

/**
 * Creates an order with server-side pricing: unit prices are always read from
 * the products table, never from the client. Decrements default-variant stock
 * for products that track inventory.
 */
export async function createOrderForTenant(input: CreateOrderInput): Promise<CreatedOrder> {
  const db = getDb();

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, input.tenantSlug))
    .limit(1);
  if (!tenant) {
    throw new OrderError("This shop is not accepting orders right now.", "TENANT_NOT_FOUND");
  }
  if (!isTenantAcceptingOrders(tenant.status)) {
    throw new OrderError(
      tenant.status === "suspended"
        ? TENANT_SUSPENDED_BUYER_MESSAGE
        : "This shop is not accepting orders right now.",
      tenant.status === "suspended" ? "TENANT_SUSPENDED" : "TENANT_NOT_FOUND"
    );
  }

  if (input.items.length === 0) {
    throw new OrderError("Your cart is empty.", "EMPTY_CART");
  }

  // One line per product + variant (a variant-less line means "the product's only variant").
  const quantities = new Map<string, { productId: string; variantId: string | null; quantity: number }>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new OrderError("Invalid item quantity.", "PRODUCT_UNAVAILABLE");
    }
    const key = `${item.productId}:${item.variantId ?? ""}`;
    const prev = quantities.get(key);
    quantities.set(key, {
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: (prev?.quantity ?? 0) + item.quantity,
    });
  }
  const productIds = [...new Set([...quantities.values()].map((q) => q.productId))];

  return db.transaction(async (tx) => {
    const catalog = await tx
      .select({
        id: products.id,
        title: products.title,
        status: products.status,
        basePrice: products.basePrice,
        trackInventory: products.trackInventory,
        variantId: productVariants.id,
        variantTitle: productVariants.title,
        variantPrice: productVariants.price,
        stockQty: productVariants.stockQty,
        hasOptions: sql<boolean>`${products.optionsJson} is not null and jsonb_array_length(${products.optionsJson}) > 0`,
      })
      .from(products)
      .leftJoin(
        productVariants,
        and(eq(productVariants.productId, products.id), eq(productVariants.active, true))
      )
      .where(and(eq(products.tenantId, tenant.id), inArray(products.id, productIds)))
      // Deterministic "first variant" (position, id) — matches products.ts / variants.ts.
      .orderBy(asc(products.id), asc(productVariants.position), asc(productVariants.id));

    // Active variants per product, display order (first = default).
    const variantsByProduct = new Map<string, (typeof catalog)[number][]>();
    for (const row of catalog) {
      const list = variantsByProduct.get(row.id) ?? [];
      list.push(row);
      variantsByProduct.set(row.id, list);
    }

    let subtotalCentavos = 0;
    const lines: Array<{
      productId: string;
      variantId: string | null;
      title: string;
      variantTitle: string | null;
      quantity: number;
      unitPriceCentavos: number;
    }> = [];

    const byProduct = new Map<string, (typeof catalog)[number]>();
    for (const { productId, variantId, quantity } of quantities.values()) {
      const rows = variantsByProduct.get(productId) ?? [];
      const first = rows[0];
      if (!first || first.status !== "active") {
        throw new OrderError(
          "One of the items in your cart is no longer available.",
          "PRODUCT_UNAVAILABLE"
        );
      }
      let row = first;
      if (variantId) {
        const match = rows.find((r) => r.variantId === variantId);
        if (!match) {
          throw new OrderError(
            `The option you picked for "${first.title}" is no longer available.`,
            "PRODUCT_UNAVAILABLE"
          );
        }
        row = match;
      } else if (first.hasOptions && rows.length > 1) {
        throw new OrderError(`Pick a size or option for "${first.title}".`, "PRODUCT_UNAVAILABLE");
      }
      byProduct.set(row.variantId ?? productId, row);
      if (row.trackInventory && row.variantId !== null && (row.stockQty ?? 0) < quantity) {
        throw new OrderError(
          `Not enough stock for "${row.title}${row.hasOptions ? ` (${row.variantTitle})` : ""}" (only ${row.stockQty ?? 0} left).`,
          "OUT_OF_STOCK"
        );
      }
      // Products with options are priced per variant; single-variant products keep
      // charging the product price (the default variant mirrors it).
      const unitPriceCentavos = toCentavos(row.hasOptions && row.variantPrice != null ? row.variantPrice : row.basePrice);
      subtotalCentavos += unitPriceCentavos * quantity;
      lines.push({
        productId,
        variantId: row.variantId,
        title: row.hasOptions && row.variantTitle ? `${row.title} (${row.variantTitle})` : row.title,
        variantTitle: row.hasOptions ? row.variantTitle : null,
        quantity,
        unitPriceCentavos,
      });
    }

    if (input.minOrderAmount > 0 && subtotalCentavos < toCentavos(input.minOrderAmount)) {
      throw new OrderError(
        `Minimum order is ₱${input.minOrderAmount}.`,
        "BELOW_MINIMUM"
      );
    }

    const deliveryFeeCentavos =
      input.deliveryType === "pickup" ? 0 : toCentavos(input.deliveryFee);

    const checkoutConfig: TenantCheckoutJson = normalizeCheckoutJson(
      input.checkoutConfig ?? {
        minOrderAmount: input.minOrderAmount,
      }
    );

    // Enforce the coupon redemption cap (Constitutional review C1). A coupon only
    // "redeems" when it would actually apply (active + subtotal >= minSubtotal), so
    // we only block in that case. Redemptions are counted against prior orders that
    // recorded this coupon code for the tenant, inside this transaction. Note: under
    // READ COMMITTED two checkouts of the same coupon racing within the same instant
    // can each see count = max-1 and both succeed, so the cap is a soft limit with a
    // narrow over-redemption window; a hard guarantee would need a dedicated counter
    // row locked FOR UPDATE (deferred — see review remediation).
    if (input.couponCode) {
      const coupon = findActiveCoupon(checkoutConfig, input.couponCode);
      if (coupon && coupon.maxRedemptions && coupon.maxRedemptions > 0) {
        const wouldApply = subtotalCentavos >= toCentavos(coupon.minSubtotal ?? 0);
        if (wouldApply) {
          const [usage] = await tx
            .select({ count: sql<number>`count(*)` })
            .from(orders)
            .where(and(eq(orders.tenantId, tenant.id), eq(orders.couponCode, coupon.code)));
          if (Number(usage?.count ?? 0) >= coupon.maxRedemptions) {
            throw new OrderError(
              "This coupon has reached its redemption limit.",
              "COUPON_LIMIT_REACHED"
            );
          }
        }
      }
    }

    const totals = computeCheckoutTotals({
      subtotal: subtotalCentavos / 100,
      deliveryFee: deliveryFeeCentavos / 100,
      checkout: checkoutConfig,
      couponCode: input.couponCode,
    });

    const discountCentavos = toCentavos(totals.discount);
    const taxCentavos = toCentavos(totals.tax);
    const totalCentavos = toCentavos(totals.total);

    // COD orders are actionable immediately (cash due on delivery); every other
    // method waits for its payment. Legacy status is derived for dual-write.
    const isCod = input.paymentMethod === "cod";
    const initialFacts = {
      orderState: "open" as const,
      paymentState: (isCod ? "cod_due" : "unpaid") as "cod_due" | "unpaid",
      fulfillmentState: "unfulfilled" as const,
      accepted: false,
    };
    const initialStatus: OrderStatus = legacyStatusOf(initialFacts);
    const locationId = await getDefaultLocationId(tx, tenant.id);

    // Per-tenant sequential order numbers (GMA-0001, GMA-0002, ...), claimed
    // atomically: the UPDATE row-locks the tenant so two concurrent checkouts
    // can't get the same number.
    const [seqRow] = await tx
      .update(tenants)
      .set({ nextOrderSeq: sql`${tenants.nextOrderSeq} + 1` })
      .where(eq(tenants.id, tenant.id))
      .returning({ nextOrderSeq: tenants.nextOrderSeq });
    const claimedSeq = (seqRow?.nextOrderSeq ?? 2) - 1;
    const orderNumber = `${orderNumberPrefix(input.tenantSlug)}-${String(claimedSeq).padStart(4, "0")}`;

    // Upsert the shop-CRM customer by phone (phone is the buyer's identity) and
    // link this order to it, so guest orders roll up into a repeat-buyer record.
    const normalizedPhone = (input.customer.phone ?? "").replace(/[^\d+]/g, "");
    let customerRecordId: string | null = null;
    if (normalizedPhone) {
      const nowTs = new Date();
      const [cust] = await tx
        .insert(customers)
        .values({
          tenantId: tenant.id,
          phone: normalizedPhone,
          name: input.customer.name,
          email: input.customer.email ?? null,
          firstOrderAt: nowTs,
          lastOrderAt: nowTs,
          ...(input.smsMarketingConsent
            ? { smsMarketingOptIn: true, smsOptInAt: nowTs, smsOptInSource: "checkout" }
            : {}),
        })
        .onConflictDoUpdate({
          target: [customers.tenantId, customers.phone],
          set: {
            name: sql`coalesce(nullif(excluded.name, ''), ${customers.name})`,
            email: sql`coalesce(nullif(excluded.email, ''), ${customers.email})`,
            lastOrderAt: nowTs,
            updatedAt: nowTs,
            // Consent is only ever granted here, never silently withdrawn by a later order.
            ...(input.smsMarketingConsent
              ? { smsMarketingOptIn: true, smsOptInAt: nowTs, smsOptInSource: "checkout" }
              : {}),
          },
        })
        .returning({ id: customers.id });
      customerRecordId = cust?.id ?? null;
    }

    // Claim one order from the checkout link (atomic: the UPDATE row-locks the
    // link, so its order limit can't be overshot by concurrent checkouts).
    if (input.checkoutLinkId) {
      const claimed = await tx
        .update(checkoutLinks)
        .set({ orderCount: sql`${checkoutLinks.orderCount} + 1` })
        .where(
          and(
            eq(checkoutLinks.id, input.checkoutLinkId),
            eq(checkoutLinks.tenantId, tenant.id),
            eq(checkoutLinks.active, true),
            sql`(${checkoutLinks.expiresAt} is null or ${checkoutLinks.expiresAt} > now())`,
            sql`(${checkoutLinks.maxOrders} is null or ${checkoutLinks.orderCount} < ${checkoutLinks.maxOrders})`
          )
        )
        .returning({ id: checkoutLinks.id });
      if (claimed.length === 0) {
        throw new OrderError("This link is no longer taking orders.", "LINK_CLOSED");
      }
    }

    const [order] = await tx
      .insert(orders)
      .values({
        tenantId: tenant.id,
        orderNumber,
        customerRecordId,
        guestName: input.customer.name,
        guestPhone: input.customer.phone,
        guestEmail: input.customer.email,
        status: initialStatus,
        subtotal: fromCentavos(subtotalCentavos),
        discount: fromCentavos(discountCentavos),
        tax: fromCentavos(taxCentavos),
        couponCode: totals.couponCode,
        deliveryFee: fromCentavos(deliveryFeeCentavos),
        total: fromCentavos(totalCentavos),
        paymentStatus: "pending",
        paymentMethod: input.paymentMethod,
        deliveryType: input.deliveryType,
        deliveryAddressJson: input.deliveryAddress ?? null,
        notes: input.notes,
        sourceChannel: input.sourceChannel ?? "storefront",
        checkoutLinkId: input.checkoutLinkId ?? null,
        utmJson: input.utmJson && Object.keys(input.utmJson).length > 0 ? input.utmJson : null,
        orderState: initialFacts.orderState,
        paymentState: initialFacts.paymentState,
        fulfillmentState: initialFacts.fulfillmentState,
        locationId,
      })
      .returning();

    if (!order) throw new Error("Failed to create order");

    await tx.insert(orderItems).values(
      lines.map((line) => ({
        orderId: order.id,
        productId: line.productId,
        variantId: line.variantId,
        titleSnapshot: line.title,
        variantSnapshot: line.variantTitle,
        quantity: line.quantity,
        unitPrice: fromCentavos(line.unitPriceCentavos),
        lineTotal: fromCentavos(line.unitPriceCentavos * line.quantity),
      }))
    );

    const [history] = await tx
      .insert(orderStatusHistory)
      .values({
        orderId: order.id,
        status: initialStatus,
        event: "create",
        toState: describeStates(initialFacts),
        note: isCod ? "Order placed (Cash on Delivery)" : "Order placed, awaiting payment",
      })
      .returning({ id: orderStatusHistory.id });

    // COD has its charge row from the start (amount due on delivery). Manual
    // and PayMongo rows are added by the checkout route once it knows which.
    if (isCod) {
      await tx
        .insert(paymentTransactions)
        .values({
          orderId: order.id,
          tenantId: tenant.id,
          gateway: "cod",
          gatewayIntentId: `cod_${order.id}`,
          amount: order.total,
          status: "pending",
          methodType: "cod",
        })
        .onConflictDoNothing({ target: paymentTransactions.gatewayIntentId });
    }

    await insertOutboxEvent(tx, {
      name: "Order.Created.V2",
      tenantId: tenant.id,
      idempotencyKey: `Order.Created.V2:${order.id}`,
      data: {
        tenantId: tenant.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentMethod: input.paymentMethod,
        sourceChannel: input.sourceChannel ?? "storefront",
        checkoutLinkId: input.checkoutLinkId ?? null,
        total: order.total,
        historyId: history?.id ?? null,
        ...initialFacts,
      },
    });

    // Decrement stock for tracked products — atomically and conditionally.
    //
    // The availability check earlier in this function (see the OUT_OF_STOCK throw
    // above) is an unlocked read: it gives the buyer a good error message on the
    // common path, but two concurrent checkouts can both pass it. The guarantee
    // lives here instead. The `stockQty >= quantity` predicate is re-evaluated by
    // Postgres as part of the UPDATE, which row-locks the variant — so a racing
    // checkout blocks until we commit, then re-checks against the committed value.
    // Zero rows returned means someone else took the stock first; throwing rolls
    // back this entire transaction (order, items, status history, customer upsert,
    // and the claimed order number).
    //
    // Do NOT reintroduce `greatest(stockQty - quantity, 0)` here. Flooring at zero
    // silently absorbs an oversell — both buyers succeed, stock clamps to 0, and
    // nothing surfaces the shortfall until someone goes to pack the order.
    for (const line of lines) {
      const row = byProduct.get(line.variantId ?? line.productId);
      if (row?.trackInventory && line.variantId) {
        const decremented = await tx
          .update(productVariants)
          .set({ stockQty: sql`${productVariants.stockQty} - ${line.quantity}` })
          .where(
            and(
              eq(productVariants.id, line.variantId),
              gte(productVariants.stockQty, line.quantity)
            )
          )
          .returning({ stockQty: productVariants.stockQty });

        if (decremented.length === 0) {
          throw new OrderError(
            `Sorry — "${line.title}" just sold out while you were checking out.`,
            "OUT_OF_STOCK"
          );
        }

        await recordStockMovement(tx, {
          tenantId: tenant.id,
          variantId: line.variantId,
          orderId: order.id,
          reason: "sale",
          delta: -line.quantity,
          balanceAfter: decremented[0]!.stockQty,
          locationId,
        });
      }
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      tenantId: tenant.id,
      status: order.status as OrderStatus,
      subtotal: order.subtotal,
      discount: order.discount ?? "0.00",
      tax: order.tax ?? "0.00",
      deliveryFee: order.deliveryFee ?? "0.00",
      total: order.total,
      totalCentavos,
      couponCode: totals.couponCode,
      accessToken: order.accessToken,
      items: lines.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        unitPrice: fromCentavos(line.unitPriceCentavos),
        lineTotal: fromCentavos(line.unitPriceCentavos * line.quantity),
      })),
    };
  });
}

export async function recordPaymentIntent(params: {
  orderId: string;
  tenantId: string;
  gatewayIntentId: string;
  amount: string;
  methodType: string;
  /** PayMongo hosted-checkout URL, so the buyer can resume paying from the order page. */
  checkoutUrl?: string;
  checkoutSessionId?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(paymentTransactions).values({
    orderId: params.orderId,
    tenantId: params.tenantId,
    gateway: "paymongo",
    gatewayIntentId: params.gatewayIntentId,
    amount: params.amount,
    status: "pending",
    methodType: params.methodType,
    checkoutUrl: params.checkoutUrl ?? null,
    rawWebhookJson:
      params.checkoutUrl || params.checkoutSessionId
        ? { checkoutUrl: params.checkoutUrl ?? null, checkoutSessionId: params.checkoutSessionId ?? null }
        : null,
  });
}

export interface MarkOrderPaidResult {
  ok: boolean;
  orderId?: string;
  orderNumber?: string;
  tenantId?: string;
  total?: string;
  /** True when this webhook call transitioned the order to paid (vs a replay). */
  transitioned?: boolean;
  /** Payment landed on a cancelled/refunded order — needs a refund. */
  paidAfterCancel?: boolean;
}

/**
 * Webhook handler: marks the payment + order paid by PayMongo intent id.
 * Idempotent and race-safe: the transaction and order rows are locked, so a
 * webhook retry arriving mid-flight waits and then sees the paid state.
 *
 * A payment that lands on an order already cancelled/refunded is recorded on
 * the transaction but does NOT revive the order or credit the seller — the
 * caller must flag it for a refund (paidAfterCancel).
 */
export async function markOrderPaidByIntent(
  gatewayIntentId: string,
  gatewayPaymentId?: string,
  rawWebhookJson?: unknown
): Promise<MarkOrderPaidResult> {
  const db = getDb();
  let applied: Awaited<ReturnType<typeof applyOrderActionInTx>> | null = null;
  const result = await db.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.gatewayIntentId, gatewayIntentId))
      .limit(1)
      .for("update");
    if (!txn) return { ok: false } as MarkOrderPaidResult;

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, txn.orderId))
      .limit(1)
      .for("update");
    if (!order) return { ok: false } as MarkOrderPaidResult;

    const now = new Date();
    const wasPaid = txn.status === "paid";
    await tx
      .update(paymentTransactions)
      .set({
        status: "paid",
        gatewayPaymentId: gatewayPaymentId ?? txn.gatewayPaymentId,
        paidAt: txn.paidAt ?? now,
        ...(rawWebhookJson !== undefined ? { rawWebhookJson } : {}),
      })
      .where(eq(paymentTransactions.id, txn.id));

    const base = {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      tenantId: order.tenantId,
      total: order.total,
    };
    const facts = factsOf(order);

    if (facts.orderState === "cancelled") {
      // Money arrived after the order closed. Record it (so "Refund" becomes
      // available) but never reopen the order or credit the seller.
      if (!wasPaid && facts.paymentState !== "paid" && facts.paymentState !== "refunded") {
        await tx
          .update(orders)
          .set({ paymentState: "paid", paymentStatus: "paid", paidAt: now })
          .where(eq(orders.id, order.id));
        const [history] = await tx
          .insert(orderStatusHistory)
          .values({
            orderId: order.id,
            status: order.status,
            event: "late_payment",
            fromState: describeStates(facts),
            toState: describeStates({ ...facts, paymentState: "paid" }),
            note: "Payment arrived after the order was closed — refund the buyer",
          })
          .returning({ id: orderStatusHistory.id });
        await insertOutboxEvent(tx, {
          name: "Order.PaidAfterClose.V1",
          tenantId: order.tenantId,
          idempotencyKey: `Order.PaidAfterClose.V1:${order.id}:${history!.id}`,
          data: { tenantId: order.tenantId, orderId: order.id, orderNumber: order.orderNumber, total: order.total },
        });
      }
      return { ...base, transitioned: false, paidAfterCancel: !wasPaid };
    }

    if (facts.paymentState === "paid") return { ...base, transitioned: false };

    applied = await applyOrderActionInTx(tx, {
      orderId: order.id,
      action: { type: "confirm_payment" },
      source: "gateway",
      payment: { rowHandled: true, gatewayPaymentId: gatewayPaymentId ?? null },
    });
    return { ...base, transitioned: applied.changed };
  });

  if (applied) await applyWalletEffects(applied);
  return result;
}

export async function markPaymentFailedByIntent(gatewayIntentId: string): Promise<void> {
  const db = getDb();
  const [txn] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.gatewayIntentId, gatewayIntentId))
    .limit(1);
  if (!txn) return;

  await db
    .update(paymentTransactions)
    .set({ status: "failed" })
    .where(eq(paymentTransactions.id, txn.id));
}

export interface TenantOrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  deliveryType: string;
  total: string;
  itemsSummary: string;
  itemCount: number;
  createdAt: Date;
  paymentReference: string | null;
  paymentProofUrl: string | null;
  /** Gateway of the settled payment (paymongo / manual / cod), when there is one. */
  paymentGateway: string | null;
  orderState: OrderState;
  paymentState: PaymentState;
  fulfillmentState: FulfillmentState;
  /** The merchant tab this order sits in (To pay · To confirm · To pack · …). */
  bucket: OrderBucket;
  acceptedAt: Date | null;
  /** Latest courier booking, if any. */
  deliveryProvider: string | null;
  /** storefront | checkout_link | … */
  sourceChannel: string;
  /** Checkout link the order came from: its seller-side name and where it was shared. */
  checkoutLink: { title: string; shareChannel: string | null } | null;
  /** Phase 11: seller-only note/tags, money given back, edits/voids. */
  staffNote: string | null;
  tags: string[];
  refundedAmount: string;
  edited: boolean;
  voided: boolean;
  invoiceNumber: string | null;
}

export async function listOrdersForTenant(tenantId: string): Promise<TenantOrderListItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .orderBy(desc(orders.createdAt))
    .limit(200);

  if (rows.length === 0) return [];

  const items = await db
    .select({
      orderId: orderItems.orderId,
      title: orderItems.titleSnapshot,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((row) => row.id)
      )
    );

  const itemsByOrder = new Map<string, Array<{ title: string; quantity: number }>>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({ title: item.title, quantity: item.quantity });
    itemsByOrder.set(item.orderId, list);
  }

  const paymentRows = await db
    .select({
      orderId: paymentTransactions.orderId,
      status: paymentTransactions.status,
      gateway: paymentTransactions.gateway,
      rawWebhookJson: paymentTransactions.rawWebhookJson,
      reference: paymentTransactions.reference,
      proofUrl: paymentTransactions.proofUrl,
    })
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.tenantId, tenantId),
        inArray(
          paymentTransactions.orderId,
          rows.map((row) => row.id)
        )
      )
    );

  const paymentMetaByOrder = new Map<
    string,
    { reference: string | null; proofUrl: string | null }
  >();
  const settledGatewayByOrder = new Map<string, string>();
  for (const txn of paymentRows) {
    if (txn.status === "paid" || txn.status === "refunded") {
      settledGatewayByOrder.set(txn.orderId, txn.gateway);
    }
    if (txn.gateway !== "manual") continue;
    const raw = (txn.rawWebhookJson ?? {}) as {
      buyerReference?: string;
      proofUrl?: string | null;
    };
    paymentMetaByOrder.set(txn.orderId, {
      reference: txn.reference ?? raw.buyerReference ?? null,
      proofUrl: txn.proofUrl ?? raw.proofUrl ?? null,
    });
  }

  const deliveryRows = await db
    .select({ orderId: deliveries.orderId, provider: deliveries.provider, bookedAt: deliveries.bookedAt })
    .from(deliveries)
    .where(
      inArray(
        deliveries.orderId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(asc(deliveries.bookedAt));
  const providerByOrder = new Map<string, string>();
  for (const d of deliveryRows) providerByOrder.set(d.orderId, d.provider);

  const linkIds = [...new Set(rows.map((row) => row.checkoutLinkId).filter((id): id is string => Boolean(id)))];
  const linkRows = linkIds.length
    ? await db
        .select({ id: checkoutLinks.id, title: checkoutLinks.title, shareChannel: checkoutLinks.shareChannel })
        .from(checkoutLinks)
        .where(and(eq(checkoutLinks.tenantId, tenantId), inArray(checkoutLinks.id, linkIds)))
    : [];
  const linkById = new Map(linkRows.map((l) => [l.id, { title: l.title, shareChannel: l.shareChannel }]));

  return rows.map((row) => {
    const orderItemsList = itemsByOrder.get(row.id) ?? [];
    const payMeta = paymentMetaByOrder.get(row.id);
    const facts = factsOf(row);
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      customerName: row.guestName ?? "Customer",
      customerPhone: row.guestPhone ?? "",
      status: row.status as OrderStatus,
      paymentStatus: row.paymentStatus ?? "pending",
      paymentMethod: row.paymentMethod ?? "",
      deliveryType: row.deliveryType ?? "delivery",
      total: row.total,
      itemCount: orderItemsList.reduce((sum, item) => sum + item.quantity, 0),
      itemsSummary: orderItemsList
        .map((item) => `${item.quantity}× ${item.title}`)
        .join(", "),
      createdAt: row.createdAt,
      paymentReference: payMeta?.reference ?? null,
      paymentProofUrl: payMeta?.proofUrl ?? null,
      paymentGateway: settledGatewayByOrder.get(row.id) ?? null,
      orderState: facts.orderState,
      paymentState: facts.paymentState,
      fulfillmentState: facts.fulfillmentState,
      bucket: orderBucketOf(facts),
      acceptedAt: row.acceptedAt,
      deliveryProvider: providerByOrder.get(row.id) ?? null,
      sourceChannel: row.sourceChannel ?? "storefront",
      checkoutLink: row.checkoutLinkId ? linkById.get(row.checkoutLinkId) ?? null : null,
      staffNote: row.staffNote,
      tags: row.tagsJson ?? [],
      refundedAmount: row.refundedAmount ?? "0",
      edited: Boolean(row.editedAt),
      voided: Boolean(row.voidedAt),
      invoiceNumber: row.invoiceNumber,
    };
  });
}

export interface PackingSlip {
  id: string;
  orderNumber: string;
  createdAt: Date;
  customerName: string;
  customerPhone: string;
  deliveryType: string;
  address: string | null;
  notes: string | null;
  staffNote: string | null;
  paymentMethod: string;
  /** Cash the rider/shop must collect (COD not yet paid). */
  collect: number;
  total: number;
  items: Array<{ title: string; quantity: number; sku: string | null }>;
}

function addressText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const a = json as Record<string, unknown>;
  if (typeof a.full === "string" && a.full.trim()) return a.full;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const parts = [str(a.line1), str(a.line2)].filter((p): p is string => Boolean(p));
  const head = parts.join(", ").toLowerCase();
  // line1 often already carries the barangay/city — don't repeat them.
  for (const extra of [str(a.barangay), str(a.city), str(a.province), str(a.postalCode)]) {
    if (extra && !head.includes(extra.toLowerCase())) parts.push(extra);
  }
  return parts.length ? parts.join(", ") : str(a.text);
}

/** Packing slips for up to 50 of the shop's orders, in the order given. */
export async function getPackingSlips(tenantId: string, orderIds: string[]): Promise<PackingSlip[]> {
  const ids = [...new Set(orderIds)].slice(0, 50);
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.id, ids)));
  const lines = await db
    .select({ orderId: orderItems.orderId, title: orderItems.titleSnapshot, quantity: orderItems.quantity, returned: orderItems.returnedQty, sku: productVariants.sku })
    .from(orderItems)
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(inArray(orderItems.orderId, ids))
    .orderBy(asc(orderItems.id));
  const byOrder = new Map<string, PackingSlip["items"]>();
  for (const l of lines) {
    const list = byOrder.get(l.orderId) ?? [];
    list.push({ title: l.title, quantity: l.quantity - (l.returned ?? 0), sku: l.sku });
    byOrder.set(l.orderId, list);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => {
      const facts = factsOf(r);
      return {
        id: r.id,
        orderNumber: r.orderNumber,
        createdAt: r.createdAt,
        customerName: r.guestName ?? "Customer",
        customerPhone: r.guestPhone ?? "",
        deliveryType: r.deliveryType ?? "delivery",
        address: addressText(r.deliveryAddressJson),
        notes: r.notes,
        staffNote: r.staffNote,
        paymentMethod: r.paymentMethod ?? "",
        collect: facts.paymentState === "cod_due" || (r.paymentMethod === "cod" && facts.paymentState !== "paid") ? Number(r.total) : 0,
        total: Number(r.total),
        items: (byOrder.get(r.id) ?? []).filter((i) => i.quantity > 0),
      };
    });
}

export interface OrderRefundInfo {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  total: string;
  totalCentavos: number;
  gateway: string | null;
  gatewayPaymentId: string | null;
}

export async function getOrderPaymentForRefund(
  tenantId: string,
  orderId: string
): Promise<OrderRefundInfo | null> {
  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);
  if (!order) return null;

  const [payment] = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "paid"))
    )
    .orderBy(desc(paymentTransactions.paidAt))
    .limit(1);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status as OrderStatus,
    paymentStatus: order.paymentStatus ?? "pending",
    paymentMethod: order.paymentMethod ?? "",
    total: order.total,
    totalCentavos: toCentavos(order.total),
    gateway: payment?.gateway ?? null,
    gatewayPaymentId: payment?.gatewayPaymentId ?? null,
  };
}

export interface OrderTrackingDelivery {
  provider: string;
  status: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverPlateNumber: string | null;
  driverLat: string | null;
  driverLng: string | null;
  driverLocationAt: Date | null;
  trackingUrl: string | null;
}

export interface OrderTrackingData {
  /** "checkout_link" for orders from a shared checkout link, else storefront/null. */
  sourceChannel: string | null;
  /** Code of the checkout link the order came through (buyer's "Bumalik sa order form"). */
  checkoutLinkCode: string | null;
  orderId: string;
  orderNumber: string;
  tenantSlug: string;
  tenantName: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  deliveryType: string;
  customerName: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  createdAt: Date;
  items: Array<{ title: string; quantity: number; unitPrice: string; lineTotal: string }>;
  history: Array<{ status: OrderStatus; note: string | null; createdAt: Date }>;
  delivery: OrderTrackingDelivery | null;
  /** "paymongo" when the buyer pays on PayMongo's page, "manual" for direct transfer. */
  paymentGateway: string | null;
  /** PayMongo page to finish paying, while the payment is still pending. */
  resumePaymentUrl: string | null;
  orderState: OrderState;
  paymentState: PaymentState;
  fulfillmentState: FulfillmentState;
}

/** Only ever hand the buyer a PayMongo-hosted URL. */
function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith("paymongo.com") ? value : null;
  } catch {
    return null;
  }
}

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Buyer-facing order lookup. Order numbers are sequential per shop, so the
 * secret `accessToken` from the buyer's link is required — a missing or wrong
 * token returns null (indistinguishable from "not found").
 */
export async function getOrderForTracking(
  tenantSlug: string,
  orderNumber: string,
  accessToken: string | null | undefined
): Promise<OrderTrackingData | null> {
  if (!accessToken || accessToken.length < 32) return null;
  const db = getDb();
  const [row] = await db
    .select({ order: orders, tenant: tenants })
    .from(orders)
    .innerJoin(tenants, eq(orders.tenantId, tenants.id))
    .where(and(eq(orders.orderNumber, orderNumber), eq(tenants.slug, tenantSlug)))
    .limit(1);
  if (!row) return null;
  if (!tokensMatch(row.order.accessToken, accessToken)) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, row.order.id));

  const history = await db
    .select()
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, row.order.id))
    .orderBy(orderStatusHistory.createdAt);

  const [delivery] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, row.order.id))
    .orderBy(desc(deliveries.bookedAt))
    .limit(1);

  const [payment] = await db
    .select({
      gateway: paymentTransactions.gateway,
      status: paymentTransactions.status,
      raw: paymentTransactions.rawWebhookJson,
      checkoutUrl: paymentTransactions.checkoutUrl,
    })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.orderId, row.order.id))
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(1);

  const [link] = row.order.checkoutLinkId
    ? await db
        .select({ code: checkoutLinks.code })
        .from(checkoutLinks)
        .where(eq(checkoutLinks.id, row.order.checkoutLinkId))
        .limit(1)
    : [];

  return {
    orderId: row.order.id,
    checkoutLinkCode: link?.code ?? null,
    paymentGateway: payment?.gateway ?? null,
    ...(() => {
      const f = factsOf(row.order);
      return { orderState: f.orderState, paymentState: f.paymentState, fulfillmentState: f.fulfillmentState };
    })(),
    resumePaymentUrl:
      payment?.gateway === "paymongo" &&
      payment.status === "pending" &&
      factsOf(row.order).orderState === "open" &&
      factsOf(row.order).paymentState === "unpaid"
        ? safeCheckoutUrl(payment.checkoutUrl ?? (payment.raw as { checkoutUrl?: unknown } | null)?.checkoutUrl)
        : null,
    sourceChannel: row.order.sourceChannel ?? null,
    orderNumber: row.order.orderNumber,
    tenantSlug: row.tenant.slug,
    tenantName: row.tenant.name,
    status: row.order.status as OrderStatus,
    paymentStatus: row.order.paymentStatus ?? "pending",
    paymentMethod: row.order.paymentMethod ?? "",
    deliveryType: row.order.deliveryType ?? "delivery",
    customerName: row.order.guestName ?? "Customer",
    subtotal: row.order.subtotal,
    deliveryFee: row.order.deliveryFee ?? "0.00",
    total: row.order.total,
    createdAt: row.order.createdAt,
    items: items.map((item) => ({
      title: item.titleSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    history: history.map((entry) => ({
      status: entry.status as OrderStatus,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
    delivery: delivery
      ? {
          provider: delivery.provider,
          status: delivery.status,
          driverName: delivery.driverName,
          driverPhone: delivery.driverPhone,
          driverPlateNumber: delivery.driverPlateNumber,
          driverLat: delivery.driverLat,
          driverLng: delivery.driverLng,
          driverLocationAt: delivery.driverLocationAt,
          trackingUrl: delivery.trackingUrl,
        }
      : null,
  };
}
