import { NextResponse } from "next/server";
import {
  applyCourierFulfillmentUpdate,
  updateDeliveryByProviderOrderId,
} from "@gumakart/db";
import {
  COURIER_NOTES,
  createLogger,
  grabFulfillment,
  verifyGrabWebhook,
} from "@gumakart/services";

const log = createLogger("webhook:grab");

/**
 * GrabExpress partner webhook.
 * Set GRAB_WEBHOOK_SECRET and register `{WEB}/api/webhooks/grab`.
 *
 * Payload shape varies by partner program — we accept the common deliveryID/status
 * fields used by the GrabAdapter parser, plus a few aliases.
 */

interface GrabWebhookBody {
  deliveryID?: string;
  deliveryId?: string;
  id?: string;
  status?: string;
  trackingURL?: string;
  trackingUrl?: string;
  driver?: {
    name?: string;
    phone?: string;
    plateNumber?: string;
    vehiclePlateNumber?: string;
  };
  signature?: string;
  timestamp?: string | number;
}


export async function POST(request: Request) {
  // Without a secret anyone could mark orders delivered — refuse everything.
  const secret = process.env.GRAB_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    log.error("GRAB_WEBHOOK_SECRET not configured; rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();

  let body: GrabWebhookBody;
  try {
    body = JSON.parse(rawBody) as GrabWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Security G2 (GK-19): signature from headers (or the body minus its own signature)
  // over a fresh timestamp — a captured event can't be replayed after 5 minutes.
  const verified = verifyGrabWebhook({ rawBody, headers: request.headers, body: body as GrabWebhookBody & Record<string, unknown>, secret });
  if (!verified.ok) {
    log.warn("Invalid Grab webhook signature", { reason: verified.reason });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const providerOrderId = body.deliveryID ?? body.deliveryId ?? body.id;
  if (!providerOrderId) {
    return NextResponse.json({ received: true });
  }

  const courierStatus = body.status?.toUpperCase();
  const driver = body.driver;

  try {
    const linked = await updateDeliveryByProviderOrderId(providerOrderId, {
      status: courierStatus,
      driverName: driver?.name,
      driverPhone: driver?.phone,
      driverPlateNumber: driver?.plateNumber ?? driver?.vehiclePlateNumber,
      pickedUp: Boolean(
        courierStatus && ["PICKING_UP", "IN_DELIVERY", "COLLECTED", "IN_PROGRESS"].includes(courierStatus)
      ),
      delivered: courierStatus === "COMPLETED" || courierStatus === "DELIVERED",
      trackingUrl: body.trackingURL ?? body.trackingUrl,
    }, "grab");

    if (!linked) {
      log.warn("Webhook for unknown Grab delivery", { providerOrderId });
      return NextResponse.json({ received: true });
    }

    const fulfillment = grabFulfillment(courierStatus);
    if (fulfillment) {
      await applyCourierFulfillmentUpdate(
        linked.orderId,
        fulfillment,
        `${COURIER_NOTES[fulfillment]} (GrabExpress)`
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    log.error("Grab webhook processing failed", error, { providerOrderId });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
