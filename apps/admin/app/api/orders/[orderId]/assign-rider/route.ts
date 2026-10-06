import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getOrderForDeliveryBooking,
  upsertManualDeliveryForOrder,
} from "@gumakart/db";
import { createLogger } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

const log = createLogger("orders:assign-rider");

/** Phase 24: parcel couriers that give a waybill/tracking number instead of a rider. */
const PARCEL_COURIERS = ["J&T Express", "LBC", "Flash Express", "Ninja Van", "2GO", "Other courier"] as const;

const bodySchema = z
  .object({
  driverName: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => v || undefined),
  driverPhone: z.string().trim().max(32).optional().or(z.literal("")).transform((v) => v || undefined),
  trackingNumber: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : undefined)),
  driverPlateNumber: z.string().trim().max(32).optional(),
  trackingUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  courierLabel: z.string().trim().max(64).optional(),
  })
  .superRefine((b, ctx) => {
    const parcel = PARCEL_COURIERS.includes((b.courierLabel ?? "") as (typeof PARCEL_COURIERS)[number]);
    if (parcel) {
      if (!b.trackingNumber || b.trackingNumber.length < 6) ctx.addIssue({ code: "custom", message: "Enter the waybill / tracking number." });
    } else {
      if (!b.driverName || b.driverName.length < 2) ctx.addIssue({ code: "custom", message: "Enter the rider's name." });
      if (!b.driverPhone || b.driverPhone.length < 7) ctx.addIssue({ code: "custom", message: "Enter the rider's phone." });
    }
  });

/**
 * Manual / offline courier (Angkas, Move It, own rider, meetup).
 * Creates or updates the deliveries row without calling a partner API.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = bodySchema.parse(await request.json());

    const order = await getOrderForDeliveryBooking(session.tenantId, orderId);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    }
    if (order.deliveryType !== "delivery") {
      return NextResponse.json(
        { ok: false, error: "This is a pickup order — no rider needed." },
        { status: 400 }
      );
    }
    // Same rule as booking, but the rider's details can still be edited while delivering.
    const updatingRider =
      order.facts.orderState === "open" &&
      ["booked", "picked_up", "out_for_delivery"].includes(order.facts.fulfillmentState);
    if (order.bookingBlockedReason && !updatingRider) {
      return NextResponse.json({ ok: false, error: order.bookingBlockedReason }, { status: 400 });
    }

    const delivery = await upsertManualDeliveryForOrder({
      orderId: order.orderId,
      driverName: body.driverName,
      driverPhone: body.driverPhone,
      driverPlateNumber: body.driverPlateNumber,
      trackingUrl: body.trackingUrl,
      courierLabel: body.courierLabel,
      ...(body.trackingNumber ? { courierName: body.courierLabel ?? null, trackingNumber: body.trackingNumber } : {}),
    });

    return NextResponse.json({
      ok: true,
      delivery: {
        provider: "manual",
        providerOrderId: delivery.providerOrderId,
        status: delivery.status,
        driverName: body.driverName,
        driverPhone: body.driverPhone,
        trackingUrl: body.trackingUrl ?? null,
        trackingNumber: body.trackingNumber ?? null,
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    log.error("Manual rider assign failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not save rider details." },
      { status: 500 }
    );
  }
}
