import { NextResponse } from "next/server";
import {
  deletePushSubscriptions,
  getTenantOwnerContact,
  getTenantSettings,
  listPushSubscriptionsForTenant,
  markOrderPaidByIntent,
  markPaymentFailedByIntent,
  markPlanPaymentPaidByIntent,
  sendWithLog,
  type MarkOrderPaidResult,
} from "@gumakart/db";
import {
  createPayMongoClient,
  parsePayMongoPaymentEvent,
  createSemaphoreClient,
  formatPhp,
  isPushConfigured,
  sendPushNotifications,
} from "@gumakart/services";

/** Browser push to every device the seller enabled notifications on. */
async function pushSellerPaymentReceived(result: MarkOrderPaidResult): Promise<void> {
  if (!result.tenantId || !result.orderNumber || !isPushConfigured()) return;

  const subscriptions = await listPushSubscriptionsForTenant(result.tenantId);
  if (subscriptions.length === 0) return;

  const total = result.total ? formatPhp(Number(result.total)) : "";
  const { expiredEndpoints } = await sendPushNotifications(subscriptions, {
    title: "Payment received 💸",
    body: `Order ${result.orderNumber}${total ? ` · ${total}` : ""} is paid. Tap to start preparing it.`,
    url: "/orders",
    tag: `order-${result.orderNumber}`,
  });
  if (expiredEndpoints.length > 0) {
    await deletePushSubscriptions(expiredEndpoints);
  }
}

/**
 * Texts the seller when a payment lands. Opt-in via the
 * "SMS me for new orders" notification setting; uses the WhatsApp business
 * number when set, otherwise the owner account's phone.
 */
async function notifySellerPaymentReceived(result: MarkOrderPaidResult): Promise<void> {
  if (!result.tenantId || !result.orderNumber) return;

  const settings = await getTenantSettings(result.tenantId);
  if (settings?.settings?.notifications?.smsOnNewOrder !== true) return;

  const owner = await getTenantOwnerContact(result.tenantId);
  const phone = settings.settings.whatsapp?.phone?.trim() || owner.phone;
  if (!phone) return;

  const total = result.total ? formatPhp(Number(result.total)) : "";
  const message = `Guma One: Payment received for order ${result.orderNumber}${
    total ? ` (${total})` : ""
  }. Open your dashboard to start preparing it.`;
  await sendWithLog(
    {
      tenantId: result.tenantId,
      orderId: result.orderId ?? null,
      channel: "sms",
      recipient: phone,
      recipe: "seller_payment_received",
      entityId: result.orderId ?? result.orderNumber,
      body: message,
      provider: "semaphore",
      kind: "transactional",
    },
    () => createSemaphoreClient().send({ to: phone, message, priority: true })
  );
}

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("paymongo-signature") ?? "";
  const paymongo = createPayMongoClient();
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";

  if (!paymongo.verifyWebhookSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Hosted checkout sends `checkout_session.payment.paid`; PayMongo may also
  // send `payment.paid` for the same payment. Both resolve to the payment
  // intent id we stored at checkout, so the second one is a no-op.
  const parsed = parsePayMongoPaymentEvent(event);
  const eventType = parsed?.type;
  const intentId = parsed?.intentId ?? parsed?.sessionId;
  const paymentId = parsed?.paymentId;
  console.info("[PayMongo Webhook]", eventType, intentId ?? "");

  try {
    const isPaid = eventType === "payment.paid" || eventType === "checkout_session.payment.paid";
    if (isPaid && intentId) {
      const paidFacts = { amountCentavos: parsed?.amountCentavos, currency: parsed?.currency };
      let result = await markOrderPaidByIntent(intentId, paymentId, event, paidFacts);
      if (!result.ok && parsed?.sessionId && parsed.sessionId !== intentId) {
        // Session created before PayMongo assigned an intent — we stored the session id.
        result = await markOrderPaidByIntent(parsed.sessionId, paymentId, event, paidFacts);
      }
      if (result.ok && result.duplicate) {
        console.warn("[PayMongo Webhook] Duplicate payment on an already-paid order — refund needed", { intentId, orderNumber: result.orderNumber });
      }
      if (result.ok && result.amountMismatch) {
        console.error("[PayMongo Webhook] Payment amount/currency did not match the charge — not confirmed", { intentId, orderNumber: result.orderNumber });
      }
      if (result.ok && result.paidAfterCancel) {
        // The order was cancelled/refunded before the money arrived. It stays
        // closed; the seller sees a history note and must refund the buyer.
        console.warn("[PayMongo Webhook] Payment arrived after order was closed — refund needed", {
          intentId,
          orderNumber: result.orderNumber,
        });
      }
      if (!result.ok) {
        // Not an order payment — check plan-upgrade billing.
        let planResult = await markPlanPaymentPaidByIntent(intentId);
        if (!planResult.ok && parsed?.sessionId && parsed.sessionId !== intentId) {
          planResult = await markPlanPaymentPaidByIntent(parsed.sessionId);
        }
        if (planResult.ok && planResult.transitioned) {
          console.info(
            "[PayMongo Webhook] Plan upgraded",
            planResult.tenantId,
            planResult.plan
          );
          if (planResult.tenantId && planResult.plan) {
            const { ensureEventsWired } = await import("@/lib/events-bootstrap");
            ensureEventsWired();
            const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
            await emitDomainEvent({
              name: EVENT_NAMES.MERCHANT_UPGRADED,
              data: {
                tenantId: planResult.tenantId,
                plan: planResult.plan,
              },
              idempotencyKey: `Merchant.Upgraded.V1:${planResult.tenantId}:${intentId}`,
            });
          }
        } else if (!planResult.ok) {
          console.warn("[PayMongo Webhook] No matching payment for intent", intentId);
        }
      } else if (result.transitioned) {
        // Only on the first transition, so webhook retries don't re-notify the seller.
        if (result.tenantId && result.orderNumber) {
          const { ensureEventsWired } = await import("@/lib/events-bootstrap");
          ensureEventsWired();
          const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
          await emitDomainEvent({
            name: EVENT_NAMES.ORDER_PAYMENT_SUCCEEDED,
            data: {
              tenantId: result.tenantId,
              orderNumber: result.orderNumber,
              total: result.total,
              gatewayIntentId: intentId,
            },
            idempotencyKey: `Order.PaymentSucceeded.V1:${intentId}`,
          });
          await emitDomainEvent({
            name: EVENT_NAMES.ORDER_SUCCEEDED,
            data: {
              tenantId: result.tenantId,
              orderNumber: result.orderNumber,
              total: result.total,
              paymentMethod: "online",
              channel: "online",
            },
            idempotencyKey: `Order.Succeeded.V1:paymongo:${intentId}`,
          });
        }
        await Promise.all([
          notifySellerPaymentReceived(result).catch((error) =>
            console.error("[PayMongo Webhook] Seller SMS failed:", error)
          ),
          pushSellerPaymentReceived(result).catch((error) =>
            console.error("[PayMongo Webhook] Seller push failed:", error)
          ),
        ]);
      }
    } else if (eventType === "payment.failed" && intentId) {
      // A failed attempt on PayMongo's page; the buyer can still retry there.
      await markPaymentFailedByIntent(intentId);
    }
  } catch (error) {
    console.error("[PayMongo Webhook] Handler error:", error);
    // Return 500 so PayMongo retries the delivery.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
