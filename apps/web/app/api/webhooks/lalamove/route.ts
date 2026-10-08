import { NextResponse } from "next/server";
import {
  applyCourierFulfillmentUpdate,
  updateDeliveryByProviderOrderId,
} from "@gumakart/db";
import {
  COURIER_NOTES,
  createLogger,
  lalamoveFulfillment,
  verifyLalamoveWebhook,
  webhookTimestampFresh,
} from "@gumakart/services";

const log = createLogger("webhook:lalamove");

/**
 * Lalamove partner webhook. Signed with the Lalamove API secret
 * (LALAMOVE_WEBHOOK_SECRET, falling back to LALAMOVE_API_SECRET) — see
 * packages/services/src/delivery/lalamove-webhook.ts for the format.
 *
 * Handles ORDER_STATUS_CHANGED (advances our order), DRIVER_ASSIGNED
 * (driver name/phone/plate) and DRIVER_LOCATION pings (live tracking).
 */

interface LalamoveWebhookBody {
  apiKey?: string;
  timestamp?: number | string;
  signature?: string;
  eventType?: string;
  data?: {
    order?: {
      orderId?: string;
      status?: string;
      shareLink?: string;
      driverId?: string;
    };
    driver?: {
      name?: string;
      phone?: string;
      plateNumber?: string;
      location?: { lat?: string | number; lng?: string | number };
      coordinates?: { lat?: string | number; lng?: string | number };
    };
    updatedAt?: string;
  };
}


export async function POST(request: Request) {
  const rawBody = await request.text();

  let body: LalamoveWebhookBody;
  try {
    body = JSON.parse(rawBody) as LalamoveWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const secret = process.env.LALAMOVE_WEBHOOK_SECRET ?? process.env.LALAMOVE_API_SECRET ?? "";
  if (!secret) {
    log.error("LALAMOVE_WEBHOOK_SECRET not configured; rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  // The path Lalamove signs is the one registered in their console; override
  // with LALAMOVE_WEBHOOK_PATH if a proxy rewrites it.
  const path = process.env.LALAMOVE_WEBHOOK_PATH?.trim() || new URL(request.url).pathname;
  const pinned = process.env.LALAMOVE_WEBHOOK_VARIANT?.trim() as
    | "json"
    | "raw"
    | "json-slash"
    | "raw-slash"
    | undefined;
  const verified = verifyLalamoveWebhook({
    payload: body,
    path,
    secret,
    rawBody,
    expectedApiKey: process.env.LALAMOVE_API_KEY?.trim() || undefined,
    only: pinned || undefined,
  });
  if (verified.ok && !pinned) {
    // Shows which signature layout Lalamove uses — pin it with LALAMOVE_WEBHOOK_VARIANT.
    log.info("Lalamove webhook signature verified", { variant: verified.variant, path });
  }
  // Security G2 (GK-19): the signed timestamp must be fresh — no replaying a
  // captured "COMPLETED" (or "CANCELED") event later.
  if (verified.ok && !webhookTimestampFresh(body.timestamp)) {
    log.warn("Stale Lalamove webhook", { path, timestamp: body.timestamp });
    return NextResponse.json({ error: "Stale event" }, { status: 401 });
  }
  if (!verified.ok) {
    log.warn("Invalid Lalamove webhook signature", {
      path,
      hasTimestamp: Boolean(body.timestamp),
      hasSignature: Boolean(body.signature),
      apiKeyMatches: !process.env.LALAMOVE_API_KEY || body.apiKey === process.env.LALAMOVE_API_KEY,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const providerOrderId = body.data?.order?.orderId;
  if (!providerOrderId) {
    return NextResponse.json({ received: true });
  }

  const courierStatus = body.data?.order?.status?.toUpperCase();
  const driver = body.data?.driver;
  const location = driver?.location ?? driver?.coordinates;

  try {
    const linked = await updateDeliveryByProviderOrderId(providerOrderId, {
      status: courierStatus,
      driverName: driver?.name,
      driverPhone: driver?.phone,
      driverPlateNumber: driver?.plateNumber,
      driverLat: location?.lat !== undefined ? String(location.lat) : undefined,
      driverLng: location?.lng !== undefined ? String(location.lng) : undefined,
      pickedUp: courierStatus === "PICKED_UP",
      delivered: courierStatus === "COMPLETED",
    }, "lalamove");

    if (!linked) {
      log.warn("Webhook for unknown Lalamove order", { providerOrderId });
      return NextResponse.json({ received: true });
    }

    // Forward-only through the order service; a courier cancel sends the
    // order back to "ready" for rebooking, never cancels it.
    const fulfillment = lalamoveFulfillment(courierStatus);
    if (fulfillment) {
      await applyCourierFulfillmentUpdate(
        linked.orderId,
        fulfillment,
        `${COURIER_NOTES[fulfillment]} (Lalamove)`
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error("Lalamove webhook processing failed", error, { providerOrderId });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
