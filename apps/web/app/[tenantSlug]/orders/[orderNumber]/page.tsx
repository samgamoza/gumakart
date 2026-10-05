import Link from "next/link";
import {
  getOrderForTracking,
  getTenantStorefrontBySlug,
  resolveTenantPaymentsSettings,
} from "@gumakart/db";
import { buildManualEwalletInstructions } from "@gumakart/services";
import { Badge, Button, Card } from "@gumakart/ui";
import { getTenant as getDemoTenant } from "@/lib/demo-data";
import { OrderAutoRefresh } from "@/components/order-auto-refresh";
import { GumaIdOrderPrompt } from "@/components/guma-id/order-prompt";
import { ManualPaymentPanel } from "@/components/manual-payment-panel";
import { MessageSellerButton } from "@/components/storefront/message-seller-button";
import { resolveStorefrontSettings } from "@/lib/storefront-settings";
import { resolveBackToChat } from "@/lib/back-to-chat";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tenantSlug: string; orderNumber: string }>;
  searchParams: Promise<{ t?: string | string[]; paid?: string | string[] }>;
}

/** Shown when the link has no (or a wrong) access token. Same page either way, so it doesn't reveal whether an order number exists. */
function OrderLinkRequired({ tenantSlug, orderNumber }: { tenantSlug: string; orderNumber: string }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-lg">
        <Card className="text-center">
          <div className="text-4xl">🔒</div>
          <h1 className="mt-3 text-xl font-bold">Open your order from your SMS</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">
            To keep your details private, order #{orderNumber} can only be viewed with the
            personal link we sent to your phone after checkout.
          </p>
          <Link href={`/${tenantSlug}`} className="mt-5 inline-block">
            <Button>Back to the shop</Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}

function formatPrice(amount: string | number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
  }).format(Number(amount));
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(value);
}

const PAYMENT_LABELS: Record<string, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  qrph: "QR Ph",
  card: "Card",
  cod: "Cash on Delivery",
};

type Facts = {
  orderState: "open" | "completed" | "cancelled";
  paymentState: string;
  fulfillmentState: string;
};

/** Buyer timeline from the three order states (Phase 2). */
function buildTimeline(f: Facts, deliveryType: string, paymentMethod: string) {
  const isPickup = deliveryType === "pickup";
  const isCod = paymentMethod === "cod";
  const fulfillmentRank: Record<string, number> = {
    unfulfilled: 0,
    ready: 1,
    booked: 2,
    picked_up: 3,
    out_for_delivery: 3,
    failed_delivery: 3,
    returned: 1,
    delivered: 4,
  };
  const rank = fulfillmentRank[f.fulfillmentState] ?? 0;
  const paid = f.paymentState === "paid" || f.paymentState === "refunded";

  const steps: Array<{ label: string; done: boolean }> = [
    { label: "Order placed", done: true },
    ...(isCod ? [] : [{ label: "Payment confirmed", done: paid }]),
    ...(isPickup
      ? [
          { label: "Ready for pickup", done: rank >= 1 },
          { label: "Picked up", done: rank >= 4 },
        ]
      : [
          { label: "Packed", done: rank >= 1 },
          { label: "Rider booked", done: rank >= 2 },
          { label: "Out for delivery", done: rank >= 3 },
          { label: "Delivered", done: rank >= 4 },
        ]),
  ];
  const firstOpen = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ ...step, active: index === firstOpen }));
}

export default async function OrderTrackingPage({ params, searchParams }: PageProps) {
  const { tenantSlug, orderNumber } = await params;
  const { t, paid } = await searchParams;
  // Back from PayMongo's page: the webhook usually lands within seconds.
  const returningFromCheckout = paid === "1";
  const accessToken = typeof t === "string" ? t : "";

  // Demo shops show a simulated order instead of hitting the database.
  const order = await getOrderForTracking(tenantSlug, orderNumber, accessToken);
  const demoTenant =
    !order && !(await getTenantStorefrontBySlug(tenantSlug)) ? getDemoTenant(tenantSlug) : null;

  if (!order && !demoTenant) {
    return <OrderLinkRequired tenantSlug={tenantSlug} orderNumber={orderNumber} />;
  }
  const tenant = demoTenant ? null : await getTenantStorefrontBySlug(tenantSlug);

  const storeSettings = tenant
    ? resolveStorefrontSettings(
        tenant.settingsJson as Parameters<typeof resolveStorefrontSettings>[0],
        tenant.currency ?? "PHP",
        tenant.checkoutPublishedJson,
        tenant.shippingPublishedJson
      )
    : null;

  const payments = resolveTenantPaymentsSettings(
    (tenant?.settingsJson ?? null) as Record<string, unknown> | null
  );
  // Direct-transfer instructions only for manual payments — PayMongo buyers pay
  // on PayMongo's page and must never be shown the shop's GCash number.
  const payInstructions =
    order && order.paymentMethod !== "cod" && order.paymentGateway !== "paymongo"
      ? buildManualEwalletInstructions({
          method:
            order.paymentMethod === "paymaya"
              ? "paymaya"
              : order.paymentMethod === "bank"
                ? "bank"
                : "gcash",
          amount: formatPrice(order.total),
          orderNumber: order.orderNumber,
          receiving: payments.receiving,
        })
      : null;

  // Demo shops show a sample in-progress COD order.
  const facts: Facts = order
    ? { orderState: order.orderState, paymentState: order.paymentState, fulfillmentState: order.fulfillmentState }
    : { orderState: "open", paymentState: "cod_due", fulfillmentState: "unfulfilled" };
  const isCancelled = facts.orderState === "cancelled";
  const isDone = facts.orderState === "completed";
  const timeline = buildTimeline(facts, order?.deliveryType ?? "delivery", order?.paymentMethod ?? "cod");
  const awaitingPayment =
    facts.orderState === "open" && (facts.paymentState === "unpaid" || facts.paymentState === "failed");
  const checkingPayment = facts.orderState === "open" && facts.paymentState === "pending_verification";
  const deliveryProblem =
    facts.orderState === "open" &&
    (facts.fulfillmentState === "failed_delivery" || facts.fulfillmentState === "returned");
  const inMotion = facts.orderState === "open" && !demoTenant;
  const tenantSettings = (tenant?.settingsJson ?? {}) as {
    social?: { chatUrl?: string };
    whatsapp?: { enabled?: boolean; phone?: string };
  };
  const backToChat = order
    ? resolveBackToChat({
        chatUrl: tenantSettings.social?.chatUrl,
        whatsappPhone: tenantSettings.whatsapp?.phone,
        whatsappEnabled: tenantSettings.whatsapp?.enabled,
        orderNumber: order.orderNumber,
      })
    : null;
  const fromLink = order?.sourceChannel === "checkout_link";
  // Checkout-link buyers saw a Taglish order form, so their order page is Taglish too.
  const tx = (en: string, tl: string) => (fromLink ? tl : en);
  const TL_STEP: Record<string, string> = {
    "Order placed": "Na-place ang order",
    "Payment confirmed": "Kumpirmado ang bayad",
    "Ready for pickup": "Ready na for pickup",
    "Picked up": "Na-pickup na",
    Packed: "Naka-pack na",
    "Rider booked": "May rider na",
    "Out for delivery": "Paparating na",
    Delivered: "Na-deliver na",
  };
  // A way back for every buyer: the shop's chat link if saved, else the order form they came from,
  // plus the online store when the shop has one.
  const orderFormHref = fromLink && order?.checkoutLinkCode ? `/c/${order.checkoutLinkCode}` : null;
  const storeBuilt = Boolean((tenant?.themeJson as { templateId?: string } | null | undefined)?.templateId);
  const primaryBack = backToChat
    ? { href: backToChat.href, label: backToChat.label, external: true }
    : orderFormHref
      ? { href: orderFormHref, label: "Bumalik sa order form", external: false }
      : null;
  const delivery = order?.delivery ?? null;
  const driverMapUrl =
    delivery?.driverLat && delivery.driverLng
      ? `https://www.google.com/maps?q=${delivery.driverLat},${delivery.driverLng}`
      : null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <OrderAutoRefresh active={inMotion} />
      <div className="mx-auto max-w-lg space-y-4">
        <Card className="text-center">
          <div className="text-4xl">
            {isCancelled ? "❌" : awaitingPayment || checkingPayment ? "⏳" : deliveryProblem ? "⚠️" : isDone ? "🎉" : "✅"}
          </div>
          <h1 className="mt-3 text-xl font-bold">
            {isCancelled
              ? facts.paymentState === "refunded"
                ? tx("Order refunded", "Na-refund ang order")
                : tx("Order cancelled", "Na-cancel ang order")
              : awaitingPayment
                ? tx("Waiting for payment", "Hinihintay ang bayad")
                : checkingPayment
                  ? tx("Checking your payment", "Chine-check ang bayad mo")
                  : deliveryProblem
                    ? tx("There was a problem with the delivery", "Nagka-problema sa delivery")
                    : isDone
                      ? tx("Order complete — salamat!", "Kumpleto na ang order — salamat!")
                      : tx("Order confirmed!", "Natanggap ang order mo!")}
          </h1>
          {checkingPayment && (
            <p className="mx-auto mt-2 max-w-xs text-sm text-gray-600">
              {tx(
                "The shop received your payment details and will confirm them shortly.",
                "Natanggap ng shop ang payment details mo. Ico-confirm nila ito agad."
              )}
            </p>
          )}
          {deliveryProblem && (
            <p className="mx-auto mt-2 max-w-xs text-sm text-gray-600">
              {tx("The shop will contact you to arrange a new delivery.", "Kokontakin ka ng shop para sa bagong delivery.")}
            </p>
          )}
          <p className="mt-1 text-gray-500">Order #{orderNumber}</p>
          {order && (
            <p className="mt-1 text-sm text-gray-400">
              {order.tenantName} · {formatTime(order.createdAt)}
            </p>
          )}
          {!isCancelled && <Badge className="mt-3">{tx("SMS updates sent to your phone", "Ite-text namin sa iyo ang updates")}</Badge>}
          {awaitingPayment && returningFromCheckout && (
            <p className="mx-auto mt-3 max-w-xs text-sm text-emerald-700">
              Thanks! We&apos;re confirming your payment with PayMongo — this page updates by itself.
            </p>
          )}
          {awaitingPayment && !returningFromCheckout && (
            <p className="mx-auto mt-3 max-w-xs text-sm text-amber-700">
              {tx(
                `Complete your ${PAYMENT_LABELS[order?.paymentMethod ?? ""] ?? "online"} payment to start the order. This page updates once payment is confirmed.`,
                `Magbayad via ${PAYMENT_LABELS[order?.paymentMethod ?? ""] ?? "online"} para masimulan ang order. Mag-a-update ang page na ito kapag na-confirm na.`
              )}
            </p>
          )}
          {primaryBack && !awaitingPayment ? (
            <a
              href={primaryBack.href}
              {...(primaryBack.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white"
              data-testid="back-to-chat"
            >
              {primaryBack.label}
            </a>
          ) : null}
          {awaitingPayment && order?.resumePaymentUrl ? (
            <a href={order.resumePaymentUrl} className="mt-4 inline-block">
              <Button>Continue to payment</Button>
            </a>
          ) : null}
        </Card>

        {order && payInstructions && storeSettings && awaitingPayment ? (
          <ManualPaymentPanel
            tenantSlug={tenantSlug}
            orderNumber={order.orderNumber}
            accessToken={accessToken}
            paymentMethod={order.paymentMethod}
            totalLabel={formatPrice(order.total)}
            instructions={payInstructions}
            shopAssistant={storeSettings.shopAssistant}
            shopName={order.tenantName}
            alreadyPaid={order.paymentState === "paid"}
            lang={fromLink ? "tl" : "en"}
          />
        ) : null}

        {!isCancelled && (
          <Card>
            <h2 className="font-semibold">
              {order?.deliveryType === "pickup" ? tx("Pickup status", "Status ng pickup") : tx("Delivery status", "Status ng delivery")}
            </h2>
            <ol className="mt-4 space-y-4">
              {timeline.map((step) => (
                <li key={step.label} className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                      step.done
                        ? "bg-emerald-600 text-white"
                        : step.active
                          ? "bg-amber-100 text-amber-700 ring-2 ring-amber-400"
                          : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {step.done ? "✓" : "·"}
                  </div>
                  <span className={step.done || step.active ? "font-medium" : "text-gray-400"}>
                    {fromLink ? (TL_STEP[step.label] ?? step.label) : step.label}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {delivery && !isCancelled && (
          <Card>
            <h2 className="font-semibold">{tx("Your rider", "Ang rider mo")}</h2>
            {delivery.driverName ? (
              <div className="mt-3 space-y-1 text-sm">
                <p className="font-medium">
                  {delivery.driverName}
                  {delivery.driverPlateNumber ? ` · ${delivery.driverPlateNumber}` : ""}
                </p>
                {delivery.driverPhone && (
                  <a href={`tel:${delivery.driverPhone}`} className="block text-emerald-700">
                    {delivery.driverPhone}
                  </a>
                )}
                {delivery.driverLocationAt && driverMapUrl && (
                  <p className="text-gray-500">
                    Last seen {formatTime(delivery.driverLocationAt)} ·{" "}
                    <a
                      href={driverMapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-700 underline"
                    >
                      View live location
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                Finding a rider for your order… this usually takes a few minutes.
              </p>
            )}
            {delivery.trackingUrl && (
              <a
                href={delivery.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Track rider on {delivery.provider === "lalamove" ? "Lalamove" : "the map"}
              </a>
            )}
          </Card>
        )}

        {order && (
          <Card>
            <h2 className="font-semibold">{tx("Order details", "Detalye ng order")}</h2>
            <div className="mt-3 space-y-2 text-sm">
              {order.items.map((item) => (
                <div key={`${item.title}-${item.quantity}`} className="flex justify-between">
                  <span className="text-gray-600">
                    {item.quantity}× {item.title}
                  </span>
                  <span>{formatPrice(item.lineTotal)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-gray-100 pt-2 text-gray-600">
                <span>{order.deliveryType === "pickup" ? "Pickup" : tx("Delivery fee", "Delivery")}</span>
                <span>{formatPrice(order.deliveryFee)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2 font-bold">
                <span>Total</span>
                <span className="text-emerald-700">{formatPrice(order.total)}</span>
              </div>
              <p className="pt-1 text-xs text-gray-400">
                {order.paymentMethod === "cod" && order.deliveryType === "pickup"
                  ? "Cash on pickup"
                  : (PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod)}{" "}
                ·{" "}
                {order.paymentState === "paid"
                  ? tx("Paid", "Bayad na")
                  : order.paymentState === "refunded"
                    ? tx("Refunded", "Na-refund")
                    : order.paymentState === "cod_due"
                      ? order.deliveryType === "pickup"
                        ? tx("Pay when you pick up", "Magbayad pag-pickup")
                        : tx("Pay on delivery", "Magbayad pagdating")
                      : order.paymentState === "pending_verification"
                        ? tx("Being checked by the shop", "Chine-check ng shop")
                        : tx("Payment pending", "Hindi pa bayad")}
              </p>
            </div>
          </Card>
        )}

        {order && Array.isArray(order.history) && order.history.length > 0 && (
          <Card>
            <h2 className="font-semibold">{tx("History", "Mga update")}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {[...order.history].reverse().map((entry, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span className="capitalize text-gray-700">
                    {String(entry.status).replace(/_/g, " ")}
                    {entry.note ? (
                      <span className="block text-xs text-gray-400">{entry.note}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {formatTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {demoTenant && (
          <Card>
            <p className="text-sm text-gray-500">Estimated delivery</p>
            <p className="text-lg font-bold">35–45 minutes</p>
            <p className="mt-2 text-sm text-emerald-700">Demo order — no payment was processed</p>
          </Card>
        )}

        {order && storeSettings && !isCancelled ? (
          <Card className="space-y-2">
            <h2 className="font-semibold">{tx("Need help with this order?", "May tanong sa order mo?")}</h2>
            <p className="text-sm text-gray-500">
              {tx(
                "Message the shop about payment proof, changes, or delivery — they reply in this chat.",
                "I-message ang shop tungkol sa bayad, pagbabago, o delivery — dito sila sasagot."
              )}
            </p>
            <MessageSellerButton
              tenantSlug={tenantSlug}
              shopName={order.tenantName}
              assistant={
                storeSettings.shopAssistant ?? {
                  enabled: true,
                  name: "Shop chat",
                  greeting: "Hi! How can we help with your order?",
                  tone: "friendly_taglish",
                  humanInbox: true,
                }
              }
              orderNumber={order.orderNumber}
              whatsapp={storeSettings.whatsapp}
              label={tx("Message seller", "I-message ang seller")}
              className="w-full justify-center rounded-xl border border-neutral-200 bg-white py-3 text-sm font-semibold"
            />
          </Card>
        ) : null}

        {order && <GumaIdOrderPrompt />}

        {/* Ways back (bottom). Paying comes first, so while unpaid the main way back lives here. */}
        <div className="space-y-2" data-testid="ways-back">
          {primaryBack && awaitingPayment ? (
            <a
              href={primaryBack.href}
              {...(primaryBack.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex w-full items-center justify-center rounded-xl border border-neutral-300 bg-white py-3 text-sm font-semibold"
              data-testid="back-to-chat"
            >
              {primaryBack.label}
            </a>
          ) : null}
          {fromLink && backToChat && orderFormHref ? (
            <Link
              href={orderFormHref}
              className="flex w-full items-center justify-center rounded-xl border border-neutral-300 bg-white py-3 text-sm font-semibold"
            >
              Bumalik sa order form
            </Link>
          ) : null}
          {(!fromLink || storeBuilt) && (
            <Link href={`/${tenantSlug}`}>
              <Button variant="secondary" className="w-full">
                {fromLink ? `Tingnan ang shop ng ${order?.tenantName ?? "seller"}` : "Continue Shopping"}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
