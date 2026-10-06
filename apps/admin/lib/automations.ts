import {
  claimRecoveryStep,
  deletePushSubscriptions,
  describeRecoveryCart,
  getOrderEmailDetails,
  getOrderMessagingContext,
  getTenantOwnerContact,
  listPushSubscriptionsForTenant,
  listRecoveryCandidates,
  listUnpaidReminderCandidates,
  listReviewRequestCandidates,
  sendWithLog,
  type OrderMessagingContext,
  type OutboxRow,
  type TenantSettingsJson,
} from "@gumakart/db";
import {
  abandonedCheckoutSms,
  createSemaphoreClient,
  deliveredSms,
  isPushConfigured,
  isEmailAddress,
  isQuietHours,
  isRecipeEnabled,
  orderEmail,
  sendTransactionalEmail,
  type BuyerEmailKind,
  outForDeliverySms,
  paymentConfirmedSms,
  readyForPickupSms,
  riderBookedSms,
  sellerDeliveryFailedSms,
  sellerNewOrderSms,
  sellerProofSubmittedSms,
  sendPushNotifications,
  unpaidReminderSms,
  reviewRequestSms,
  withOptOutFooter,
  type BuyerRecipe,
  type OrderSmsContext,
} from "@gumakart/services";
import { storefrontBaseUrl } from "@/lib/utils";
import { sendBackInStockAlerts } from "@/lib/stock-alerts";

/**
 * Phase 4 — automatic SMS.
 *
 * 1. Event recipes run inside the outbox relay (`/api/cron/outbox`): each order
 *    event is handed to `handleOrderEvent`. Idempotency comes from message_log
 *    (`recipe:orderId:step`), so a replayed event never texts twice.
 * 2. Timed recipes (`/api/cron/automations`): abandoned checkout (30 min, 24 h)
 *    and the unpaid-order reminder (6 h). Both are marketing: buyer consent
 *    required, "Stop reminders" link, never 9 PM – 8 AM Manila.
 *
 * Events older than 24 h are recorded but not texted (a backlog after an outage
 * shouldn't wake buyers up about yesterday).
 */

export const EVENT_MAX_AGE_MS = 24 * 3_600_000;

type Outcome = { recipe: string; status: string } | null;

function webBase(): string {
  return storefrontBaseUrl.replace(/\/$/, "");
}

function orderUrl(ctx: OrderMessagingContext): string {
  return `${webBase()}/${ctx.tenantSlug}/orders/${ctx.orderNumber}?t=${ctx.accessToken}`;
}

function smsContext(ctx: OrderMessagingContext, extra: Partial<OrderSmsContext> = {}): OrderSmsContext {
  return {
    shopName: ctx.tenantName,
    orderNumber: ctx.orderNumber,
    total: ctx.total,
    paymentMethod: ctx.paymentMethod,
    deliveryType: ctx.deliveryType,
    orderUrl: orderUrl(ctx),
    pickupAddress: ctx.settings.delivery?.pickupAddress ?? null,
    courier: ctx.courier,
    codDue: ctx.paymentState === "cod_due",
    ...extra,
  };
}

async function textBuyer(
  ctx: OrderMessagingContext,
  recipe: BuyerRecipe,
  body: string,
  kind: "transactional" | "marketing" = "transactional",
  step = 0
): Promise<Outcome> {
  if (!ctx.phone || ctx.phone.replace(/\D/g, "").length < 10) return { recipe, status: "no_phone" };
  if (!isRecipeEnabled(ctx.settings.automations, recipe)) return { recipe, status: "off" };
  const phone = ctx.phone;
  const sms = createSemaphoreClient();
  const result = await sendWithLog(
    {
      tenantId: ctx.tenantId,
      orderId: ctx.orderId,
      channel: "sms",
      recipient: phone,
      recipe,
      step,
      entityId: ctx.orderId,
      body,
      provider: "semaphore",
      kind,
    },
    () => sms.send({ to: phone, message: body, priority: kind === "transactional" })
  );
  return { recipe, status: result.status };
}

/**
 * Phase 13: the email copy of a buyer text (only when the buyer typed an email at
 * checkout and the shop left "Email copies" on). Own message_log key (`email_<recipe>`),
 * so SMS and email never block each other. Transactional only.
 */
async function emailBuyer(ctx: OrderMessagingContext, kind: BuyerEmailKind, extra: { codDue?: boolean } = {}): Promise<Outcome> {
  const recipe = `email_${kind}`;
  if (!isEmailAddress(ctx.email)) return { recipe, status: "no_email" };
  if (ctx.settings.automations?.email_copies === false) return { recipe, status: "off" };
  const details = await getOrderEmailDetails(ctx.orderId);
  if (!details) return null;
  const mail = orderEmail(kind, {
    shopName: ctx.tenantName,
    orderNumber: ctx.orderNumber,
    buyerName: ctx.buyerName,
    items: details.items,
    subtotal: details.subtotal,
    deliveryFee: details.deliveryFee,
    discount: details.discount,
    total: details.total,
    paymentMethod: ctx.paymentMethod,
    deliveryType: ctx.deliveryType,
    orderUrl: orderUrl(ctx),
    pickupAddress: ctx.settings.delivery?.pickupAddress ?? null,
    courier: ctx.courier,
    codDue: extra.codDue ?? ctx.paymentState === "cod_due",
  });
  const to = ctx.email.trim();
  const result = await sendWithLog(
    {
      tenantId: ctx.tenantId,
      orderId: ctx.orderId,
      channel: "email",
      recipient: to,
      recipe,
      entityId: ctx.orderId,
      body: mail.text,
      provider: "resend",
      kind: "transactional",
    },
    async () => {
      const sent = await sendTransactionalEmail({ to, subject: mail.subject, text: mail.text, html: mail.html, tags: [{ name: "recipe", value: recipe }] });
      return { success: sent.sent || Boolean(sent.mock), messageId: sent.id, error: sent.error, mock: sent.mock };
    }
  );
  return { recipe, status: result.status };
}

/** Both copies of a buyer update: the text (per-recipe switch) and the email. */
async function notifyBuyer(
  ctx: OrderMessagingContext,
  recipe: BuyerRecipe & BuyerEmailKind,
  sms: string,
  extra: { codDue?: boolean } = {}
): Promise<Outcome> {
  const [text, email] = await Promise.all([textBuyer(ctx, recipe, sms), emailBuyer(ctx, recipe, extra)]);
  return text?.status === "sent" || !email ? text : { recipe, status: `${text?.status ?? "none"}+email_${email.status}` };
}

/** Seller's alert number: Business → mobile, else WhatsApp number, else the owner's phone. */
async function sellerPhone(tenantId: string, settings: TenantSettingsJson): Promise<string | null> {
  const fromSettings = settings.contact?.mobile?.trim() || settings.whatsapp?.phone?.trim();
  if (fromSettings) return fromSettings;
  const owner = await getTenantOwnerContact(tenantId).catch(() => null);
  return owner?.phone ?? null;
}

async function alertSeller(
  ctx: OrderMessagingContext,
  recipe: string,
  sms: string,
  push: { title: string; body: string } | null
): Promise<Outcome> {
  if (push && isPushConfigured()) {
    try {
      const subscriptions = await listPushSubscriptionsForTenant(ctx.tenantId);
      if (subscriptions.length > 0) {
        const { expiredEndpoints } = await sendPushNotifications(subscriptions, {
          ...push,
          url: "/orders",
          tag: `order-${ctx.orderNumber}`,
        });
        if (expiredEndpoints.length > 0) await deletePushSubscriptions(expiredEndpoints);
      }
    } catch (error) {
      console.error(`[automations] push ${recipe} failed`, error);
    }
  }
  // SMS to the seller is opt-in ("Text me about new orders" in Notifications).
  if (ctx.settings.notifications?.smsOnNewOrder !== true) return { recipe, status: push ? "push_only" : "off" };
  const phone = await sellerPhone(ctx.tenantId, ctx.settings);
  if (!phone) return { recipe, status: "no_phone" };
  const client = createSemaphoreClient();
  const result = await sendWithLog(
    {
      tenantId: ctx.tenantId,
      orderId: ctx.orderId,
      channel: "sms",
      recipient: phone,
      recipe,
      entityId: ctx.orderId,
      body: sms,
      provider: "semaphore",
      kind: "transactional",
    },
    () => client.send({ to: phone, message: sms, priority: true })
  );
  return { recipe, status: result.status };
}

/**
 * Outbox consumer. Throwing makes the relay retry the event later (with
 * back-off); provider failures are recorded in message_log and not retried.
 */
export async function handleOrderEvent(row: OutboxRow, now = new Date()): Promise<Outcome> {
  const orderId = typeof row.data.orderId === "string" ? row.data.orderId : null;
  if (!orderId) return null;
  if (now.getTime() - new Date(row.createdAt).getTime() > EVENT_MAX_AGE_MS) return { recipe: row.name, status: "too_old" };

  const handled = new Set([
    "Order.Created.V2",
    "Order.PaymentSubmitted.V1",
    "Order.PaymentConfirmed.V1",
    "Fulfillment.Ready.V1",
    "Fulfillment.Booked.V1",
    "Fulfillment.OutForDelivery.V1",
    "Fulfillment.Delivered.V1",
    "Fulfillment.Failed.V1",
  ]);
  if (!handled.has(row.name)) return null;

  const ctx = await getOrderMessagingContext(orderId);
  if (!ctx) return null;
  // The event's own snapshot decides "was COD still due at that moment".
  const eventPaymentState = typeof row.data.paymentState === "string" ? row.data.paymentState : ctx.paymentState;
  const codDue = eventPaymentState === "cod_due";
  const buyerSilenced = ctx.orderState === "cancelled";

  switch (row.name) {
    case "Order.Created.V2": {
      // The "order received" text is sent at checkout; the email copy goes from here.
      if (ctx.sourceChannel !== "pos" && !buyerSilenced) await emailBuyer(ctx, "order_created");
      // COD orders need the seller now; e-wallet orders alert when proof arrives.
      // (The instant COD push is sent at checkout; this adds the opt-in SMS.)
      if (ctx.paymentMethod !== "cod") return null;
      return alertSeller(
        ctx,
        "seller_new_order",
        sellerNewOrderSms({ orderNumber: ctx.orderNumber, total: ctx.total, buyerName: ctx.buyerName, paymentMethod: ctx.paymentMethod }),
        null
      );
    }
    case "Order.PaymentSubmitted.V1":
      return alertSeller(ctx, "seller_payment_proof", sellerProofSubmittedSms({ orderNumber: ctx.orderNumber, total: ctx.total }), {
        title: "Payment proof received 🧾",
        body: `Order ${ctx.orderNumber}: the buyer sent their payment. Check your wallet and confirm it.`,
      });
    case "Fulfillment.Failed.V1":
      return alertSeller(ctx, "seller_delivery_failed", sellerDeliveryFailedSms({ orderNumber: ctx.orderNumber }), {
        title: "Delivery failed ⚠️",
        body: `Order ${ctx.orderNumber} couldn't be delivered. Open it to arrange a new delivery.`,
      });
    case "Order.PaymentConfirmed.V1":
      if (buyerSilenced || ctx.paymentMethod === "cod") return null;
      return notifyBuyer(ctx, "payment_confirmed", paymentConfirmedSms(smsContext(ctx)));
    case "Fulfillment.Ready.V1":
      // "Ready" for a delivery order just means packed — only pickup buyers need to know.
      if (buyerSilenced || ctx.deliveryType !== "pickup") return null;
      return notifyBuyer(ctx, "shipped", readyForPickupSms(smsContext(ctx, { codDue })), { codDue });
    case "Fulfillment.Booked.V1":
      if (buyerSilenced || ctx.deliveryType === "pickup") return null;
      return notifyBuyer(ctx, "shipped", riderBookedSms(smsContext(ctx)));
    case "Fulfillment.OutForDelivery.V1":
      if (buyerSilenced) return null;
      return notifyBuyer(ctx, "out_for_delivery", outForDeliverySms(smsContext(ctx, { codDue })), { codDue });
    case "Fulfillment.Delivered.V1":
      return notifyBuyer(ctx, "delivered", deliveredSms(smsContext(ctx)));
  }
  return null;
}

export interface TimedRunResult {
  quietHours: boolean;
  recovery: { considered: number; sent: number; skipped: number };
  unpaid: { considered: number; sent: number; skipped: number };
  /** Phase 23: "rate your order" texts. */
  reviews: { considered: number; sent: number; skipped: number };
  /** Phase 22: back-in-stock alerts. */
  backInStock: { considered: number; sent: number; waiting: number };
}

/** Timed recipes 6 and 7. Safe to run every 5 minutes. */
export async function runTimedAutomations(now = new Date()): Promise<TimedRunResult> {
  const result: TimedRunResult = {
    quietHours: isQuietHours(now),
    recovery: { considered: 0, sent: 0, skipped: 0 },
    unpaid: { considered: 0, sent: 0, skipped: 0 },
    reviews: { considered: 0, sent: 0, skipped: 0 },
    backInStock: { considered: 0, sent: 0, waiting: 0 },
  };
  if (result.quietHours) return result;

  // Recipe 6 — unfinished checkout.
  for (const candidate of await listRecoveryCandidates({ now, limit: 50 })) {
    result.recovery.considered += 1;
    if (!isRecipeEnabled(candidate.settings.automations, "abandoned_checkout")) {
      result.recovery.skipped += 1;
      continue;
    }
    const cart = await describeRecoveryCart(candidate.tenantId, candidate.tenantSlug, candidate.cartJson);
    if (!cart) {
      // Link closed / nothing to return to: stop retrying this session.
      await claimRecoveryStep(candidate.sessionId, 2, now);
      result.recovery.skipped += 1;
      continue;
    }
    let body: string;
    try {
      body = withOptOutFooter(
        abandonedCheckoutSms({
          shopName: candidate.tenantName,
          productTitle: cart.productTitle,
          url: `${webBase()}${cart.path}`,
          step: candidate.step,
        }),
        candidate.phone,
        webBase()
      );
    } catch (error) {
      // No opt-out secret: reminders can't be sent legally. Leave the session untouched.
      console.error("[automations] opt-out link unavailable — reminders off", error);
      result.recovery.skipped += 1;
      continue;
    }
    if (!(await claimRecoveryStep(candidate.sessionId, candidate.step, now))) {
      result.recovery.skipped += 1;
      continue;
    }
    const sms = createSemaphoreClient();
    const sent = await sendWithLog(
      {
        tenantId: candidate.tenantId,
        channel: "sms",
        recipient: candidate.phone,
        recipe: "abandoned_checkout",
        step: candidate.step,
        entityId: candidate.sessionId,
        body,
        provider: "semaphore",
        kind: "marketing",
      },
      () => sms.send({ to: candidate.phone, message: body })
    );
    if (sent.status === "sent") result.recovery.sent += 1;
    else result.recovery.skipped += 1;
  }

  // Recipe 7 — unpaid e-wallet order.
  for (const { orderId } of await listUnpaidReminderCandidates({ now, limit: 50 })) {
    result.unpaid.considered += 1;
    const ctx = await getOrderMessagingContext(orderId);
    if (!ctx || !ctx.phone) {
      result.unpaid.skipped += 1;
      continue;
    }
    let body: string;
    try {
      body = withOptOutFooter(unpaidReminderSms(smsContext(ctx)), ctx.phone, webBase());
    } catch (error) {
      console.error("[automations] opt-out link unavailable — reminders off", error);
      result.unpaid.skipped += 1;
      continue;
    }
    const outcome = await textBuyer(ctx, "unpaid_reminder", body, "marketing", 1);
    if (outcome?.status === "sent") result.unpaid.sent += 1;
    else result.unpaid.skipped += 1;
  }

  // Phase 22 — back-in-stock alerts the buyers asked for.
  result.backInStock = await sendBackInStockAlerts(webBase()).catch((error) => {
    console.error("[automations] back-in-stock", error);
    return result.backInStock;
  });

  // Phase 23 — ask for a review 2 days after delivery (opt-in recipe; consent; once per order).
  for (const orderId of await listReviewRequestCandidates(now, 50)) {
    result.reviews.considered += 1;
    const ctx = await getOrderMessagingContext(orderId);
    if (!ctx || !ctx.phone || !isRecipeEnabled(ctx.settings.automations, "review_request")) {
      result.reviews.skipped += 1;
      continue;
    }
    let body: string;
    try {
      body = withOptOutFooter(reviewRequestSms(smsContext(ctx)), ctx.phone, webBase());
    } catch (error) {
      console.error("[automations] opt-out link unavailable — review requests off", error);
      result.reviews.skipped += 1;
      continue;
    }
    const outcome = await textBuyer(ctx, "review_request", body, "marketing", 1);
    if (outcome?.status === "sent") result.reviews.sent += 1;
    else result.reviews.skipped += 1;
  }

  return result;
}
