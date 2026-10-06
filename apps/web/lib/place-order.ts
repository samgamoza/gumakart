/**
 * The one order pipeline behind every checkout surface (plan §5: "one checkout
 * implementation, not two"): the storefront cart (/api/checkout) and checkout
 * links (/api/c/<code>/order). Callers parse + authorize; this validates against
 * the shop's settings, prices server-side, creates the order and starts payment.
 */
import { NextResponse } from "next/server";
import type { StorefrontTenantRecord } from "@gumakart/db";
import { z } from "zod";
import {
  createOrderForTenant,
  deletePushSubscriptions,
  isPaymentMethodEnabled,
  listPushSubscriptionsForTenant,
  markCheckoutSessionConverted,
  OrderError,
  recordDeliveryQuote,
  recordManualPaymentIntent,
  recordPaymentIntent,
  getPlatformSetting,
  PAYMENTS_MODE_KEY,
  resolveTenantPaymentsSettings,
  sendWithLog,
  upsertCheckoutSession,
} from "@gumakart/db";
import {
  buildManualEwalletInstructions,
  createLogger,
  createSemaphoreClient,
  isRecipeEnabled,
  orderCreatedSms,
  formatPhp,
  IntegrationNotConfiguredError,
  isPushConfigured,
  resolvePaymentAdapterId,
  resolvePaymentsMode,
  sendPushNotifications,
  startOnlinePayment,
  type CheckoutPaymentMethod,
} from "@gumakart/services";

const log = createLogger("checkout");
import { getCheckoutDeliveryQuote } from "@/lib/delivery-quote";
import { currentBuyer } from "@/lib/guma-id";
import { linkOrderToBuyer } from "@gumakart/db";
import {
  computeDeliveryFee,
  resolveStorefrontSettings,
} from "@/lib/storefront-settings";

const PH_MOBILE = /^(09\d{9}|\+639\d{9})$/;

export const checkoutSchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  paymentMethod: z.enum(["gcash", "paymaya", "qrph", "cod", "card", "bank"]),
  fulfillment: z.enum(["delivery", "pickup"]).default("delivery"),
  sessionKey: z.string().min(8).max(64).optional(),
  couponCode: z.string().trim().max(64).optional(),
  /** Phase 17: gift card / store credit code (pays as much as its balance covers). */
  giftCardCode: z.string().trim().max(24).optional(),
  /** Unticked by default: "Text me reminders about this order". */
  smsConsent: z.boolean().optional().default(false),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(PH_MOBILE, "Enter a valid PH mobile number (09XX XXX XXXX).")),
    email: z.string().trim().email().max(255).optional().or(z.literal("")),
  }),
  address: z.string().trim().max(500).optional(),
  street1: z.string().trim().max(255).optional(),
  street2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        /** Size/colour pick for products with options (Phase 9). */
        variantId: z.string().uuid().nullish(),
        qty: z.number().int().min(1).max(99),
      })
    )
    .min(1, "Your cart is empty.")
    .max(50),
  /** Phase 13: where the buyer came from (?ref=tiktok, utm_*, click ids); sanitized server-side. */
  utm: z.record(z.string().max(200)).optional(),
});

/** Path to the buyer's order page. The `t` token is what lets them see it. */
export function orderPath(tenantSlug: string, orderNumber: string, accessToken: string): string {
  return `/${tenantSlug}/orders/${encodeURIComponent(orderNumber)}?t=${accessToken}`;
}

function trackingUrl(tenantSlug: string, orderNumber: string, accessToken: string): string {
  const base = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";
  return `${base}${orderPath(tenantSlug, orderNumber, accessToken)}`;
}

/**
 * Buyer's "order received" SMS. Logged in message_log with a per-order
 * idempotency key, so a retried checkout request can't text twice. Never
 * fails the checkout.
 */
async function sendOrderConfirmationSms(
  order: { id: string; tenantId: string; orderNumber: string; total: string; amountDue?: string; giftCardAmount?: string; paidInFull?: boolean },
  phone: string,
  link: string,
  meta: { shopName: string; paymentMethod: string; deliveryType: string; automations?: Record<string, boolean | undefined> | null }
): Promise<void> {
  if (!isRecipeEnabled(meta.automations, "order_created")) return;
  const message = orderCreatedSms({
    shopName: meta.shopName,
    orderNumber: order.orderNumber,
    // Phase 17: part paid by gift card → the text says what's still to pay.
    total: Number(order.giftCardAmount ?? 0) > 0 && !order.paidInFull ? order.amountDue ?? order.total : order.total,
    paymentMethod: meta.paymentMethod,
    deliveryType: meta.deliveryType,
    orderUrl: link,
  });
  const sms = createSemaphoreClient();
  const result = await sendWithLog(
    {
      tenantId: order.tenantId,
      orderId: order.id,
      channel: "sms",
      recipient: phone,
      recipe: "order_created",
      entityId: order.id,
      body: message,
      provider: "semaphore",
      kind: "transactional",
    },
    () => sms.send({ to: phone, message, priority: true })
  ).catch((error) => {
    console.error("[checkout] SMS log failed:", error);
    return null;
  });
  if (result?.status === "failed") console.error("[checkout] SMS failed:", result.error);
}

/** COD orders skip the payment webhook, so notify the seller right away. */
async function pushSellerNewCodOrder(
  tenantId: string,
  orderNumber: string,
  total: string,
  ewallet?: "gcash" | "paymaya" | "bank"
): Promise<void> {
  if (!isPushConfigured()) return;
  const subscriptions = await listPushSubscriptionsForTenant(tenantId);
  if (subscriptions.length === 0) return;

  const { expiredEndpoints } = await sendPushNotifications(subscriptions, {
    title: ewallet ? "New order 🛍️" : "New COD order 🛵",
    body: ewallet
      ? `Order ${orderNumber} · ${formatPhp(Number(total))} — waiting for the buyer's ${ewallet === "paymaya" ? "Maya" : ewallet === "bank" ? "bank" : "GCash"} payment.`
      : `Order ${orderNumber} · ${formatPhp(Number(total))} — cash on delivery. Tap to accept it.`,
    url: "/orders",
    tag: `order-${orderNumber}`,
  });
  if (expiredEndpoints.length > 0) {
    await deletePushSubscriptions(expiredEndpoints);
  }
}

async function emitOrderEvents(input: {
  tenantId: string;
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  total: string;
  succeeded: boolean;
}) {
  try {
    const { ensureEventsWired } = await import("@/lib/events-bootstrap");
    ensureEventsWired();
    const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
    await emitDomainEvent({
      name: EVENT_NAMES.ORDER_CREATED,
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        paymentMethod: input.paymentMethod,
        total: input.total,
      },
      idempotencyKey: `Order.Created.V1:${input.orderId}`,
    });
    if (input.succeeded) {
      await emitDomainEvent({
        name: EVENT_NAMES.ORDER_SUCCEEDED,
        data: {
          tenantId: input.tenantId,
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          paymentMethod: input.paymentMethod,
          total: input.total,
          channel: input.paymentMethod === "cod" ? "cod" : "online",
        },
        idempotencyKey: `Order.Succeeded.V1:${input.orderId}`,
      });
    }
  } catch (error) {
    console.error("[checkout] event emit failed:", error);
  }
}


export type CheckoutBody = z.infer<typeof checkoutSchema>;

export interface PlaceOrderContext {
  /** orders.source_channel / checkout_sessions.source_channel */
  sourceChannel: "storefront" | "checkout_link";
  checkoutLinkId?: string | null;
  utm?: Record<string, string> | null;
  /** What to store as the abandoned-checkout cart (defaults to the items). */
  sessionCart?: unknown;
}

export async function placeOrder(
  tenant: StorefrontTenantRecord,
  body: CheckoutBody,
  ctx: PlaceOrderContext
): Promise<NextResponse> {
  try {
    const settings = resolveStorefrontSettings(
      tenant.settingsJson,
      tenant.currency,
      tenant.checkoutPublishedJson,
      tenant.shippingPublishedJson
    );
    const checkoutConfig = settings.checkout;

    if (!isPaymentMethodEnabled(checkoutConfig, body.paymentMethod)) {
      return NextResponse.json(
        { error: "That payment method is not available for this shop." },
        { status: 400 }
      );
    }
    if (body.paymentMethod === "cod" && !settings.codEnabled) {
      return NextResponse.json(
        { error: "Cash on Delivery is not available for this shop." },
        { status: 400 }
      );
    }
    if (body.fulfillment === "pickup" && !settings.delivery.pickupEnabled) {
      return NextResponse.json(
        { error: "Store pickup is not available for this shop." },
        { status: 400 }
      );
    }
    if (checkoutConfig.customer?.requireEmail && !body.customer.email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (body.fulfillment === "delivery") {
      const street = body.street1?.trim() || body.address?.trim();
      if (!street || street.length < 5) {
        return NextResponse.json(
          { error: "Please enter your street address." },
          { status: 400 }
        );
      }
      if (!body.province?.trim() || !body.city?.trim() || !body.barangay?.trim()) {
        return NextResponse.json(
          { error: "Please enter province, city/town, and barangay." },
          { status: 400 }
        );
      }
    }

    if (body.sessionKey) {
      await upsertCheckoutSession({
        tenantId: tenant.id,
        sessionKey: body.sessionKey,
        cartJson: ctx.sessionCart ?? body.items,
        customerJson: body.customer,
        addressJson: {
          line1: body.street1 || body.address,
          line2: body.street2,
          city: body.city,
          barangay: body.barangay,
          province: body.province,
          postalCode: body.postalCode,
        },
        couponCode: body.couponCode ?? null,
        phone: body.customer.phone,
        marketingConsent: body.smsConsent,
        sourceChannel: ctx.sourceChannel,
        utmJson: ctx.utm ?? undefined,
      }).catch((error) => console.error("[checkout] session upsert failed:", error));
    }

    const priceById = new Map(tenant.products.map((p) => [p.id, Number(p.basePrice)]));
    const variantPriceById = new Map(tenant.products.flatMap((p) => p.variants.map((v) => [v.id, Number(v.price)] as const)));
    const estimatedSubtotal = body.items.reduce(
      (sum, item) =>
        sum + ((item.variantId ? variantPriceById.get(item.variantId) : undefined) ?? priceById.get(item.productId) ?? 0) * item.qty,
      0
    );

    const liveQuote =
      body.fulfillment === "delivery" && body.address
        ? await getCheckoutDeliveryQuote(settings, body.address)
        : null;
    const deliveryFee =
      body.fulfillment === "pickup"
        ? 0
        : liveQuote?.fee ??
          computeDeliveryFee(estimatedSubtotal, settings, {
            city: body.city,
            barangay: body.barangay,
            province: body.province,
            postalCode: body.postalCode,
          });

    const order = await createOrderForTenant({
      tenantSlug: body.tenantSlug,
      items: body.items.map((item) => ({ productId: item.productId, variantId: item.variantId ?? null, quantity: item.qty })),
      customer: {
        name: body.customer.name,
        phone: body.customer.phone,
        email: body.customer.email || undefined,
      },
      deliveryType: body.fulfillment,
      deliveryAddress:
        body.fulfillment === "delivery" && (body.address || body.street1)
          ? {
              line1: body.address || body.street1 || "",
              line2: body.street2,
              city: body.city,
              barangay: body.barangay,
              province: body.province,
              postalCode: body.postalCode,
              notes: body.notes,
            }
          : undefined,
      paymentMethod: body.paymentMethod,
      deliveryFee,
      minOrderAmount: settings.minOrderAmount,
      checkoutConfig,
      couponCode: body.couponCode,
      notes: body.notes,
      sourceChannel: ctx.sourceChannel,
      smsMarketingConsent: body.smsConsent,
      checkoutLinkId: ctx.checkoutLinkId ?? null,
      utmJson: ctx.utm ?? null,
      giftCardCode: body.giftCardCode || null,
    });

    // Phase 12: a signed-in Guma ID buyer whose verified number is on the order gets it
    // in "My orders" (only when the numbers match — never someone else's order).
    try {
      const buyer = await currentBuyer();
      if (buyer) await linkOrderToBuyer(order.id, buyer);
    } catch (error) {
      console.error("[checkout] guma id link failed:", error);
    }

    if (body.sessionKey) {
      await markCheckoutSessionConverted({
        tenantId: order.tenantId,
        sessionKey: body.sessionKey,
        orderId: order.id,
      }).catch((error) => console.error("[checkout] session convert failed:", error));
    }

    if (liveQuote) {
      await recordDeliveryQuote({
        tenantId: order.tenantId,
        orderId: order.id,
        provider: liveQuote.provider,
        quoteId: liveQuote.quotationId,
        fee: liveQuote.fee.toFixed(2),
        etaMinutes: liveQuote.etaMinutes,
        rawResponseJson: { meta: liveQuote.meta, dropoffAddress: body.address },
      }).catch((error) => console.error("[checkout] Failed to record quote:", error));
    }

    const paymentsSettings = resolveTenantPaymentsSettings(
      tenant.settingsJson as Record<string, unknown>
    );
    const platformPaymentsMode = await getPlatformSetting(PAYMENTS_MODE_KEY);
    const paymentsMode = resolvePaymentsMode({
      settingsMode: paymentsSettings.mode || platformPaymentsMode,
    });
    const adapter = resolvePaymentAdapterId(
      body.paymentMethod as CheckoutPaymentMethod,
      paymentsMode
    );

    const smsMeta = {
      shopName: tenant.name,
      paymentMethod: body.paymentMethod,
      deliveryType: body.fulfillment,
      automations: (tenant.settingsJson as { automations?: Record<string, boolean | undefined> } | null)?.automations ?? null,
    };

    await emitOrderEvents({
      tenantId: order.tenantId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentMethod: body.paymentMethod,
      total: order.total,
      succeeded: adapter === "cod",
    });

    // Phase 17: the gift card / store credit covered everything — nothing left to pay.
    if (order.paidInFull) {
      await sendOrderConfirmationSms(order, body.customer.phone, trackingUrl(body.tenantSlug, order.orderNumber, order.accessToken), { ...smsMeta, paymentMethod: "gift_card" });
      await pushSellerNewCodOrder(order.tenantId, order.orderNumber, order.total).catch((error) => console.error("[checkout] Seller push failed:", error));
      return NextResponse.json({
        orderNumber: order.orderNumber,
        orderUrl: orderPath(body.tenantSlug, order.orderNumber, order.accessToken),
        status: order.status,
        paymentMethod: "gift_card",
        adapter: "gift_card",
        totals: { subtotal: order.subtotal, discount: order.discount, tax: order.tax, deliveryFee: order.deliveryFee, total: order.total, giftCard: order.giftCardAmount, amountDue: order.amountDue },
      });
    }

    if (adapter === "cod") {
      await sendOrderConfirmationSms(order, body.customer.phone, trackingUrl(body.tenantSlug, order.orderNumber, order.accessToken), smsMeta);

      await pushSellerNewCodOrder(order.tenantId, order.orderNumber, order.total).catch(
        (error) => console.error("[checkout] Seller push failed:", error)
      );

      return NextResponse.json({
        orderNumber: order.orderNumber,
        orderUrl: orderPath(body.tenantSlug, order.orderNumber, order.accessToken),
        status: order.status,
        paymentMethod: "cod",
        adapter: "cod",
        totals: {
          subtotal: order.subtotal,
          discount: order.discount,
          tax: order.tax,
          deliveryFee: order.deliveryFee,
          total: order.total,
          giftCard: order.giftCardAmount,
          amountDue: order.amountDue,
        },
      });
    }

    if (adapter === "manual_ewallet") {
      const method =
        body.paymentMethod === "paymaya"
          ? "paymaya"
          : body.paymentMethod === "bank"
            ? "bank"
            : "gcash";

      await recordManualPaymentIntent({
        orderId: order.id,
        tenantId: order.tenantId,
        amount: order.amountDue,
        methodType: method,
        orderNumber: order.orderNumber,
      });

      const payInstructions = buildManualEwalletInstructions({
        method,
        amount: formatPhp(Number(order.amountDue)),
        orderNumber: order.orderNumber,
        receiving: paymentsSettings.receiving,
      });

      await sendOrderConfirmationSms(order, body.customer.phone, trackingUrl(body.tenantSlug, order.orderNumber, order.accessToken), smsMeta);

      await pushSellerNewCodOrder(order.tenantId, order.orderNumber, order.total, method).catch(
        (error) => console.error("[checkout] Seller push (manual pay) failed:", error)
      );

      return NextResponse.json({
        orderNumber: order.orderNumber,
        orderUrl: orderPath(body.tenantSlug, order.orderNumber, order.accessToken),
        status: order.status,
        paymentMethod: method,
        adapter: "manual_ewallet",
        payInstructions,
        totals: {
          subtotal: order.subtotal,
          discount: order.discount,
          tax: order.tax,
          deliveryFee: order.deliveryFee,
          total: order.total,
          giftCard: order.giftCardAmount,
          amountDue: order.amountDue,
        },
      });
    }

    if (body.paymentMethod === "bank") {
      return NextResponse.json(
        { error: "Bank transfer requires manual e-wallet mode." },
        { status: 400 }
      );
    }

    const started = await startOnlinePayment({
      amountCentavos: order.amountDueCentavos,
      description: `Order ${order.orderNumber} — ${tenant.name}`,
      method: body.paymentMethod as Exclude<CheckoutPaymentMethod, "cod" | "bank">,
      metadata: { order_number: order.orderNumber, tenant: body.tenantSlug, order_id: order.id },
      returnUrl: trackingUrl(body.tenantSlug, order.orderNumber, order.accessToken),
      referenceNumber: order.orderNumber,
      lineItemName: `Order ${order.orderNumber} — ${tenant.name}`,
    });

    await recordPaymentIntent({
      orderId: order.id,
      tenantId: order.tenantId,
      gatewayIntentId: started.paymentIntentId,
      amount: order.amountDue,
      methodType: body.paymentMethod,
      checkoutUrl: started.redirectUrl,
      checkoutSessionId: started.checkoutSessionId,
    });

    await sendOrderConfirmationSms(order, body.customer.phone, trackingUrl(body.tenantSlug, order.orderNumber, order.accessToken), smsMeta);

    return NextResponse.json({
      orderNumber: order.orderNumber,
      orderUrl: orderPath(body.tenantSlug, order.orderNumber, order.accessToken),
      paymentIntentId: started.paymentIntentId,
      redirectUrl: started.redirectUrl,
      status: order.status,
      adapter: started.adapter,
      totals: {
        subtotal: order.subtotal,
        discount: order.discount,
        tax: order.tax,
        deliveryFee: order.deliveryFee,
        total: order.total,
      },
    });
  } catch (error) {
    if (error instanceof OrderError) {
      const status = error.code === "TENANT_SUSPENDED" ? 403 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof IntegrationNotConfiguredError) {
      log.error("Integration not configured", error, { integration: error.integration });
      return NextResponse.json(
        {
          error: error.message,
          integration: error.integration,
          code: "integration_not_configured",
        },
        { status: 503 }
      );
    }
    log.error("Checkout failed", error);
    return NextResponse.json(
      { error: "Checkout failed. Please try again." },
      { status: 500 }
    );
  }
}

