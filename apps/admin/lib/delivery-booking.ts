import { getOrderForDeliveryBooking, getTenantOwnerContact, getTenantSettings } from "@gumakart/db";
import { geocodeAddress, type DeliveryPolicy, type DeliveryProviderId, type DispatchInput } from "@gumakart/services";

/** A booking problem the seller can fix; `status` is the HTTP status to answer with. */
export class BookingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const PROVIDER_LABELS: Record<DeliveryProviderId, string> = {
  lalamove: "Lalamove",
  grab: "GrabExpress",
  bayango: "BayanGo",
  manual: "Own rider (flat fee)",
};

function bookingAllowList(preferred: "lalamove" | "grab" | "manual" | undefined): DeliveryProviderId[] {
  if (preferred === "manual") return ["manual"];
  // BayanGo is only quoted when BAYANGO_ENABLED=true (the adapter gates itself).
  if (preferred === "grab") return ["grab", "lalamove", "bayango", "manual"];
  return ["lalamove", "grab", "bayango", "manual"];
}

export interface PreparedBooking {
  order: NonNullable<Awaited<ReturnType<typeof getOrderForDeliveryBooking>>>;
  input: Omit<DispatchInput, "quotes">;
  policy: DeliveryPolicy;
}

/**
 * Shared by "compare couriers" and "book": checks the order can get a rider, locates both
 * addresses and builds the dispatch input. Phase 33 (H7) split this out of book-delivery.
 */
export async function prepareBooking(tenantId: string, tenantName: string, orderId: string): Promise<PreparedBooking> {
  const order = await getOrderForDeliveryBooking(tenantId, orderId);
  if (!order) throw new BookingError("Order not found.", 404);
  if (order.deliveryType !== "delivery") throw new BookingError("This is a pickup order — no rider needed.", 400);
  if (order.existingProviderOrderId) throw new BookingError("A rider is already booked for this order.", 409);
  if (order.bookingBlockedReason) throw new BookingError(order.bookingBlockedReason, 400);
  if (order.dropoffAddress.trim().length < 10) throw new BookingError("The order has no usable delivery address.", 400);

  const tenantSettings = await getTenantSettings(tenantId);
  const delivery = tenantSettings?.settings?.delivery;
  const preferred = delivery?.provider ?? "lalamove";
  const pickupAddress = delivery?.pickupAddress?.trim() ?? "";
  const flatFee = Number(delivery?.flatRate ?? 0) || 0;

  if (preferred !== "manual" && !pickupAddress) {
    throw new BookingError("Set your store pickup address first (Settings → Delivery & Shipping).", 400);
  }

  const [pickup, dropoff] = await Promise.all([
    geocodeAddress(pickupAddress || order.dropoffAddress),
    geocodeAddress(order.dropoffAddress),
  ]);
  if (!dropoff || (preferred !== "manual" && !pickup)) {
    throw new BookingError("Could not locate the pickup or delivery address on the map.", 400);
  }

  const owner = await getTenantOwnerContact(tenantId);
  const senderPhone = tenantSettings?.settings?.whatsapp?.phone?.trim() || owner.phone || undefined;

  return {
    order,
    input: {
      request: {
        pickup: {
          address: pickupAddress || `Store · ${tenantName}`,
          coordinates: pickup ? { lat: String(pickup.lat), lng: String(pickup.lng) } : undefined,
        },
        dropoff: { address: order.dropoffAddress, coordinates: { lat: String(dropoff.lat), lng: String(dropoff.lng) } },
      },
      recipientName: order.customerName,
      recipientPhone: order.customerPhone,
      senderName: tenantName,
      senderPhone,
      remarks: [order.orderNumber, order.dropoffNotes].filter(Boolean).join(" · "),
      externalRef: order.orderId,
      merchant: { externalId: tenantId, name: tenantName, phone: senderPhone },
      codAmount: order.codAmount,
    },
    policy: {
      allow: bookingAllowList(preferred),
      manualFlatFee: flatFee,
      preferInHouse: process.env.BAYANGO_PREFERRED === "true",
    },
  };
}
