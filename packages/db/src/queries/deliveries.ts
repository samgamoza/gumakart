import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { deliveries, deliveryQuotes, orderStatusHistory, orders } from "../schema/index";
import { applyOrderAction, factsOf } from "./order-lifecycle";
import { getDefaultLocationId } from "./locations";
import { bookingBlockedReason, type FulfillmentState, type OrderFacts } from "./order-state";

export interface RecordDeliveryQuoteInput {
  tenantId: string;
  orderId?: string;
  provider: "lalamove" | "grab" | "manual" | "bayango";
  quoteId: string;
  fee: string;
  currency?: string;
  etaMinutes?: number;
  expiresAt?: Date;
  rawResponseJson?: unknown;
}

export async function recordDeliveryQuote(input: RecordDeliveryQuoteInput): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(deliveryQuotes)
    .values({
      tenantId: input.tenantId,
      orderId: input.orderId,
      provider: input.provider,
      quoteId: input.quoteId,
      fee: input.fee,
      currency: input.currency ?? "PHP",
      etaMinutes: input.etaMinutes,
      expiresAt: input.expiresAt,
      rawResponseJson: input.rawResponseJson,
    })
    .returning({ id: deliveryQuotes.id });
  if (!row) throw new Error("Failed to record delivery quote");
  return row.id;
}

export interface CreateDeliveryBookingInput {
  orderId: string;
  quoteId?: string;
  provider: "lalamove" | "grab" | "manual" | "bayango";
  providerOrderId: string;
  status: string;
  trackingUrl?: string;
}

export async function createDeliveryBooking(input: CreateDeliveryBookingInput): Promise<string> {
  const db = getDb();
  const [order] = await db
    .select({ tenantId: orders.tenantId, locationId: orders.locationId })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!order) throw new Error("Order not found for delivery booking");
  const pickupLocationId = order.locationId ?? (await getDefaultLocationId(db, order.tenantId));
  const [row] = await db
    .insert(deliveries)
    .values({
      orderId: input.orderId,
      quoteId: input.quoteId,
      provider: input.provider,
      providerOrderId: input.providerOrderId,
      status: input.status,
      trackingUrl: input.trackingUrl,
      bookedAt: new Date(),
      pickupLocationId,
    })
    .returning({ id: deliveries.id });
  if (!row) throw new Error("Failed to create delivery booking");
  // The provider accepted the job → fulfillment "booked" (no-op if already further along).
  await applyCourierFulfillmentUpdate(input.orderId, "booked", `Rider booked with ${input.provider}`);
  return row.id;
}

export interface DeliveryStatusPatch {
  status?: string;
  driverName?: string;
  driverPhone?: string;
  driverPlateNumber?: string;
  driverLat?: string;
  driverLng?: string;
  trackingUrl?: string;
  pickedUp?: boolean;
  delivered?: boolean;
}

/**
 * Applies a provider webhook update. Returns the linked order (id + tenant)
 * so the caller can advance the order status, or null when we don't know
 * this provider order id.
 */
export async function updateDeliveryByProviderOrderId(
  providerOrderId: string,
  patch: DeliveryStatusPatch,
  /** Security G2 (GK-19): the courier the webhook came from — a Grab id can never move a Lalamove booking. */
  provider?: "lalamove" | "grab" | "manual" | "bayango"
): Promise<{ deliveryId: string; orderId: string; tenantId: string; orderStatus: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ delivery: deliveries, order: orders })
    .from(deliveries)
    .innerJoin(orders, eq(deliveries.orderId, orders.id))
    .where(provider ? and(eq(deliveries.providerOrderId, providerOrderId), eq(deliveries.provider, provider)) : eq(deliveries.providerOrderId, providerOrderId))
    .limit(1);
  if (!row) return null;

  const now = new Date();
  const hasLocation = patch.driverLat !== undefined && patch.driverLng !== undefined;
  await db
    .update(deliveries)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.driverName !== undefined ? { driverName: patch.driverName } : {}),
      ...(patch.driverPhone !== undefined ? { driverPhone: patch.driverPhone } : {}),
      ...(patch.driverPlateNumber !== undefined
        ? { driverPlateNumber: patch.driverPlateNumber }
        : {}),
      ...(hasLocation
        ? { driverLat: patch.driverLat, driverLng: patch.driverLng, driverLocationAt: now }
        : {}),
      ...(patch.trackingUrl !== undefined ? { trackingUrl: patch.trackingUrl } : {}),
      ...(patch.pickedUp ? { pickedUpAt: now } : {}),
      ...(patch.delivered ? { deliveredAt: now } : {}),
    })
    .where(eq(deliveries.id, row.delivery.id));

  return {
    deliveryId: row.delivery.id,
    orderId: row.order.id,
    tenantId: row.order.tenantId,
    orderStatus: row.order.status,
  };
}

export interface OrderDeliveryInfo {
  provider: string;
  status: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverPlateNumber: string | null;
  driverLat: string | null;
  driverLng: string | null;
  driverLocationAt: Date | null;
  trackingUrl: string | null;
  /** Phase 24: parcel courier and waybill number (null for riders). */
  courierName: string | null;
  trackingNumber: string | null;
  bookedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
}

/**
 * Courier status → order fulfillment, through the order service (source
 * "courier": forward-only, stale or replayed events are no-ops). A booking the
 * courier cancelled before pickup sends the order back to "ready" so the
 * seller can rebook — it never cancels the order.
 */
export async function applyCourierFulfillmentUpdate(
  orderId: string,
  next: FulfillmentState | "booking_cancelled",
  note?: string
): Promise<boolean> {
  const result = await applyOrderAction({
    orderId,
    action: next === "booking_cancelled" ? { type: "booking_cancelled" } : { type: "fulfillment_update", to: next },
    source: "courier",
    note,
  });
  return result.changed;
}

export interface OrderForDeliveryBooking {
  orderId: string;
  orderNumber: string;
  status: string;
  facts: OrderFacts;
  /** Why "Book delivery" isn't allowed right now, or null. */
  bookingBlockedReason: string | null;
  deliveryType: string;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  dropoffNotes: string;
  existingProviderOrderId: string | null;
  /** Pesos the rider collects on delivery; 0 for prepaid orders. */
  codAmount: number;
}

export async function getOrderForDeliveryBooking(
  tenantId: string,
  orderId: string
): Promise<OrderForDeliveryBooking | null> {
  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.tenantId !== tenantId) return null;

  const address = (order.deliveryAddressJson ?? {}) as { line1?: string; notes?: string };
  const [existing] = await db
    .select({ providerOrderId: deliveries.providerOrderId })
    .from(deliveries)
    .where(eq(deliveries.orderId, order.id))
    .limit(1);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    facts: factsOf(order),
    bookingBlockedReason: bookingBlockedReason(factsOf(order)),
    deliveryType: order.deliveryType ?? "delivery",
    customerName: order.guestName ?? "Customer",
    customerPhone: order.guestPhone ?? "",
    dropoffAddress: address.line1 ?? "",
    dropoffNotes: address.notes ?? "",
    existingProviderOrderId: existing?.providerOrderId ?? null,
    // Cash the rider must collect: the order total while a COD order is unpaid.
    codAmount: factsOf(order).paymentState === "cod_due" ? Number(order.total) : 0,
  };
}

export interface UpsertManualDeliveryInput {
  orderId: string;
  /** Rider details (Angkas, own rider…). Optional for parcel couriers with a tracking number. */
  driverName?: string | null;
  driverPhone?: string | null;
  driverPlateNumber?: string;
  trackingUrl?: string;
  courierLabel?: string;
  /** Phase 24: parcel courier waybill. */
  courierName?: string | null;
  trackingNumber?: string | null;
}

/**
 * Seller-entered rider (Angkas / Move It / own rider). Creates a manual
 * delivery row when none exists, or patches driver fields on the latest one.
 */
export async function upsertManualDeliveryForOrder(
  input: UpsertManualDeliveryInput
): Promise<{ providerOrderId: string; status: string; deliveryId: string }> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, input.orderId))
    .orderBy(desc(deliveries.bookedAt))
    .limit(1);

  const statusLabel = input.courierLabel
    ? `ASSIGNED_${input.courierLabel.replace(/\s+/g, "_").toUpperCase()}`
    : "ASSIGNED_MANUAL";

  if (existing) {
    await db
      .update(deliveries)
      .set({
        provider: "manual",
        status: statusLabel,
        driverName: input.driverName ?? null,
        driverPhone: input.driverPhone ?? null,
        ...(input.courierName !== undefined ? { courierName: input.courierName } : {}),
        ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
        ...(input.driverPlateNumber !== undefined
          ? { driverPlateNumber: input.driverPlateNumber }
          : {}),
        ...(input.trackingUrl !== undefined ? { trackingUrl: input.trackingUrl } : {}),
      })
      .where(eq(deliveries.id, existing.id));
    return {
      deliveryId: existing.id,
      providerOrderId: existing.providerOrderId ?? `manual_${existing.id}`,
      status: statusLabel,
    };
  }

  const providerOrderId = `manual_${input.orderId.slice(0, 8)}_${Date.now()}`;
  const [row] = await db
    .insert(deliveries)
    .values({
      orderId: input.orderId,
      provider: "manual",
      providerOrderId,
      status: statusLabel,
      driverName: input.driverName ?? null,
      driverPhone: input.driverPhone ?? null,
      driverPlateNumber: input.driverPlateNumber,
      trackingUrl: input.trackingUrl,
      courierName: input.courierName ?? null,
      trackingNumber: input.trackingNumber ?? null,
      bookedAt: new Date(),
    })
    .returning({ id: deliveries.id });
  if (!row) throw new Error("Failed to create manual delivery");
  await applyCourierFulfillmentUpdate(
    input.orderId,
    "booked",
    input.trackingNumber ? `Shipped via ${input.courierName ?? "courier"} · ${input.trackingNumber}` : "Rider assigned by seller"
  );
  return { deliveryId: row.id, providerOrderId, status: statusLabel };
}

export async function getDeliveryForOrder(orderId: string): Promise<OrderDeliveryInfo | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, orderId))
    .orderBy(desc(deliveries.bookedAt))
    .limit(1);
  if (!row) return null;
  return {
    provider: row.provider,
    status: row.status,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    driverPlateNumber: row.driverPlateNumber,
    driverLat: row.driverLat,
    driverLng: row.driverLng,
    driverLocationAt: row.driverLocationAt,
    trackingUrl: row.trackingUrl,
    courierName: row.courierName,
    trackingNumber: row.trackingNumber,
    bookedAt: row.bookedAt,
    pickedUpAt: row.pickedUpAt,
    deliveredAt: row.deliveredAt,
  };
}
