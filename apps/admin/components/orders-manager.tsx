"use client";

import { useShopRole } from "@/lib/use-shop-role";
import { OrderTools } from "@/components/order-tools";
import { CourierCompare } from "@/components/courier-compare";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, formatPrice } from "@gumakart/ui";

type OrderState = "open" | "completed" | "cancelled";
type PaymentState =
  | "unpaid"
  | "pending_verification"
  | "paid"
  | "cod_due"
  | "failed"
  | "refunded"
  | "partially_refunded";
type FulfillmentState =
  | "unfulfilled"
  | "ready"
  | "booked"
  | "picked_up"
  | "out_for_delivery"
  | "delivered"
  | "failed_delivery"
  | "returned";
type Bucket =
  | "to_pay"
  | "to_confirm"
  | "to_pack"
  | "to_ship"
  | "shipping"
  | "attention"
  | "done"
  | "cancelled";

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  deliveryType: string;
  total: string;
  giftCardAmount?: string;
  itemsSummary: string;
  preorderShipDate?: string | null;
  itemCount: number;
  createdAt: string;
  paymentReference?: string | null;
  paymentProofUrl?: string | null;
  paymentGateway?: string | null;
  orderState: OrderState;
  paymentState: PaymentState;
  fulfillmentState: FulfillmentState;
  bucket: Bucket;
  acceptedAt: string | null;
  deliveryProvider: string | null;
  sourceChannel?: string;
  salesChannel?: string | null;
  externalOrderId?: string | null;
  socialThreadId?: string | null;
  checkoutLink?: { title: string; shareChannel: string | null } | null;
  staffNote?: string | null;
  tags?: string[];
  refundedAmount?: string;
  edited?: boolean;
  voided?: boolean;
  invoiceNumber?: string | null;
}

const SHARE_CHANNEL_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  messenger: "Messenger",
  shopee: "Shopee",
  lazada: "Lazada",
  other: "Other",
};

/** Where the order came from, e.g. "Checkout link · Payday post (Facebook)". */
function sourceLabel(order: OrderRow): string | null {
  if (order.sourceChannel === "pos") return "In-store (POS)";
  // Phase 13: marketplace imports, chat orders and tagged links.
  if (order.sourceChannel === "marketplace") return `${SHARE_CHANNEL_LABEL[order.salesChannel ?? ""] ?? "Marketplace"} order ${order.externalOrderId ?? ""}`.trim();
  const via = order.salesChannel && SHARE_CHANNEL_LABEL[order.salesChannel] ? SHARE_CHANNEL_LABEL[order.salesChannel] : null;
  const chat = order.socialThreadId ? " · from chat" : "";
  if (order.sourceChannel !== "checkout_link") return via ? `Online store · ${via}${chat}` : null;
  if (!order.checkoutLink) return `Checkout link${via ? ` · ${via}` : ""}${chat}`;
  const where = via ?? (order.checkoutLink.shareChannel ? SHARE_CHANNEL_LABEL[order.checkoutLink.shareChannel] : null);
  return `Checkout link · ${order.checkoutLink.title}${where ? ` (${where})` : ""}${chat}`;
}

/** Merchant tabs, in the order work happens (plan §6). */
const TABS: Array<{ id: "all" | Bucket; label: string }> = [
  { id: "all", label: "All" },
  { id: "to_pay", label: "To pay" },
  { id: "to_confirm", label: "To confirm" },
  { id: "to_pack", label: "To pack" },
  { id: "to_ship", label: "To ship" },
  { id: "shipping", label: "Shipping" },
  { id: "attention", label: "Needs attention" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
];
type TabId = (typeof TABS)[number]["id"];

type SellerAction =
  | "accept"
  | "mark_ready"
  | "mark_out_for_delivery"
  | "mark_delivered"
  | "mark_failed_delivery"
  | "mark_returned"
  | "reject_payment"
  | "cancel";

const BUCKET_STYLES: Record<Bucket, string> = {
  to_pay: "bg-muted text-muted-foreground",
  to_confirm: "bg-amber-50 text-amber-800",
  to_pack: "bg-blue-50 text-blue-700",
  to_ship: "bg-cyan-50 text-cyan-700",
  shipping: "bg-orange-50 text-orange-700",
  attention: "bg-red-50 text-red-700",
  done: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-600",
};

function statusLabel(order: OrderRow): string {
  if (order.orderState === "cancelled") {
    if (order.paymentState === "refunded") return "Refunded";
    if (order.paymentState === "paid") return "Cancelled — paid, needs refund";
    return "Cancelled";
  }
  if (order.orderState === "completed") return order.deliveryType === "pickup" ? "Picked up" : "Delivered";
  switch (order.bucket) {
    case "to_pay":
      return "Waiting for payment";
    case "to_confirm":
      return order.fulfillmentState === "delivered" ? "Delivered — confirm payment" : "Check payment";
    case "to_pack":
      return order.paymentState === "cod_due" ? "To pack · COD" : "To pack · Paid";
    case "to_ship":
      return order.deliveryType === "pickup" ? "Ready for pickup" : "Packed — book a rider";
    case "shipping":
      return {
        booked: "Rider booked",
        picked_up: "Rider has it",
        out_for_delivery: "Out for delivery",
      }[order.fulfillmentState as "booked" | "picked_up" | "out_for_delivery"] ?? "Shipping";
    case "attention":
      return order.fulfillmentState === "returned" ? "Returned to shop" : "Delivery failed";
    default:
      return order.bucket;
  }
}

/** The one-tap next step. */
function nextAction(order: OrderRow): { label: string; action: SellerAction } | null {
  if (order.orderState !== "open") return null;
  const isPickup = order.deliveryType === "pickup";
  const payable = order.paymentState === "paid" || order.paymentState === "cod_due";
  if (payable && order.fulfillmentState === "unfulfilled") {
    return { label: isPickup ? "Ready for pickup" : "Mark packed", action: "mark_ready" };
  }
  if (order.fulfillmentState === "ready" && isPickup) {
    return { label: "Mark picked up", action: "mark_delivered" };
  }
  if (["booked", "picked_up"].includes(order.fulfillmentState) && order.deliveryProvider === "manual") {
    return { label: "Out for delivery", action: "mark_out_for_delivery" };
  }
  if (order.fulfillmentState === "out_for_delivery") {
    return { label: "Mark delivered", action: "mark_delivered" };
  }
  return null;
}

const IN_TRANSIT = new Set<FulfillmentState>(["picked_up", "out_for_delivery"]);

/** Paid orders leave through Refund (money goes back), never a bare cancel. */
function canCancel(order: OrderRow): boolean {
  return (
    order.orderState === "open" &&
    order.paymentState !== "paid" &&
    !IN_TRANSIT.has(order.fulfillmentState) &&
    order.fulfillmentState !== "delivered"
  );
}

/** Includes cancelled orders whose payment arrived after the cancel. */
function canRefund(order: OrderRow): boolean {
  // Shopee/Lazada refund their own orders; cancellations sync in.
  if (order.sourceChannel === "marketplace") return false;
  return order.paymentState === "paid" && !IN_TRANSIT.has(order.fulfillmentState);
}

function canBook(order: OrderRow): boolean {
  return (
    order.deliveryType === "delivery" &&
    order.orderState === "open" &&
    (order.paymentState === "paid" || order.paymentState === "cod_due") &&
    ["unfulfilled", "ready", "failed_delivery", "returned"].includes(order.fulfillmentState)
  );
}

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function OrdersManager() {
  const perms = useShopRole();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("all");
  const [tagFilter, setTagFilter] = useState("");
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  // Dashboard to-do tiles link here as /orders?tab=to_confirm etc.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.id === wanted)) setTab(wanted as TabId);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /** Phase 33 (H7): the order whose courier prices are being compared. */
  const [compareOrder, setCompareOrder] = useState<OrderRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignOrder, setAssignOrder] = useState<OrderRow | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({
    courierLabel: "Angkas",
    driverName: "",
    driverPhone: "",
    driverPlateNumber: "",
    trackingUrl: "",
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (data.ok) {
        setOrders(data.orders);
        setError(null);
      } else {
        setError(data.error ?? "Could not load orders.");
      }
    } catch {
      setError("Could not load orders. Check your connection.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function runAction(order: OrderRow, action: SellerAction, extra?: { note?: string; reason?: string }) {
    setUpdatingId(order.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not update the order.");
        return;
      }
      if (data.cancelCourierBooking) {
        setNotice(
          `Order ${order.orderNumber} cancelled. A rider was already booked — cancel it in the courier's app too.`
        );
      }
      await load(true);
    } catch {
      setError("Network error while updating the order.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function submitAssignRider() {
    if (!assignOrder) return;
    setAssignSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${assignOrder.id}/assign-rider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignForm),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not save rider.");
        return;
      }
      setNotice(
        `Rider ${assignForm.driverName} assigned on ${assignOrder.orderNumber} (${assignForm.courierLabel}).`
      );
      setAssignOrder(null);
      await load(true);
    } catch {
      setError("Network error while saving rider details.");
    } finally {
      setAssignSaving(false);
    }
  }

  async function confirmPayment(order: OrderRow) {
    const what =
      order.paymentMethod === "cod"
        ? `the cash for ${order.orderNumber}`
        : `${formatPrice(Number(order.total))} for ${order.orderNumber} via ${order.paymentMethod.toUpperCase()}`;
    if (!window.confirm(`Confirm that you received ${what}?`)) return;

    setUpdatingId(order.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Could not confirm payment.");
        return;
      }
      setNotice(`Payment confirmed for ${order.orderNumber}.`);
      await load(true);
    } catch {
      setError("Network error while confirming payment.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function refundOrder(order: OrderRow) {
    const confirmed = window.confirm(
      `Refund order ${order.orderNumber} (${formatPrice(Number(order.total))})?` +
        (order.paymentMethod === "cod"
          ? "\n\nCOD order — you'll need to return the cash to the customer yourself."
          : order.paymentGateway === "paymongo"
            ? "\n\nThe amount will be refunded through PayMongo."
            : "\n\nPaid by direct transfer — send the money back to the customer yourself, then confirm here.")
    );
    if (!confirmed) return;

    setUpdatingId(order.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/refund`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Refund failed.");
        return;
      }
      setNotice(
        data.refundedOutsidePlatform
          ? `Order ${order.orderNumber} marked refunded. Remember to return the money to the customer.`
          : `Order ${order.orderNumber} refunded through PayMongo.`
      );
      await load(true);
    } catch {
      setError("Network error while refunding the order.");
    } finally {
      setUpdatingId(null);
    }
  }

  const counts = useMemo(() => {
    const map = new Map<TabId, number>();
    map.set("all", orders.length);
    for (const order of orders) map.set(order.bucket, (map.get(order.bucket) ?? 0) + 1);
    return map;
  }, [orders]);

  const allTags = useMemo(() => [...new Set(orders.flatMap((o) => o.tags ?? []))].sort(), [orders]);
  const visible = useMemo(
    () =>
      (tab === "all" ? orders : orders.filter((order) => order.bucket === tab)).filter(
        (order) => !tagFilter || (order.tags ?? []).includes(tagFilter)
      ),
    [orders, tab, tagFilter]
  );
  const slipIds = visible.filter((o) => o.orderState !== "cancelled").slice(0, 50).map((o) => o.id);

  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {TABS.map((tabDef) => {
          const count = counts.get(tabDef.id) ?? 0;
          if ((tabDef.id === "cancelled" || tabDef.id === "attention") && count === 0) return null;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === tabDef.id
                  ? "bg-emerald-600 text-white"
                  : "bg-card text-muted-foreground ring-1 ring-gray-200 hover:bg-muted"
              }`}
            >
              {tabDef.label}
              {count > 0 && tabDef.id !== "all" && (
                <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-xs">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {(allTags.length > 0 || (tab === "to_pack" && slipIds.length > 0)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {allTags.length > 0 && (
            <select
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filter by tag"
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
          {slipIds.length > 0 && (tab === "to_pack" || tab === "to_ship") && (
            <a
              href={`/orders/slips?ids=${slipIds.join(",")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              🖨️ Print packing slips ({slipIds.length})
            </a>
          )}
        </div>
      )}

      {toolsFor && (
        <OrderTools
          orderId={toolsFor}
          onClose={() => setToolsFor(null)}
          onChanged={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 break-all rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <Card>
          <p className="text-muted-foreground">Loading orders...</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="text-center">
          <div className="text-4xl">🧾</div>
          <h2 className="mt-3 font-semibold">
            {orders.length === 0 ? "No orders yet" : "Nothing here"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {orders.length === 0
              ? "Share your shop link on Facebook, TikTok, or Instagram — new orders will appear here the moment a customer checks out."
              : "No orders in this tab right now."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((order) => {
            const action = nextAction(order);
            const busy = updatingId === order.id;
            const showProof =
              order.paymentState === "pending_verification" &&
              (order.paymentReference || order.paymentProofUrl);
            const canConfirm =
              order.orderState === "open" &&
              (order.paymentState === "pending_verification" ||
                ((order.paymentState === "unpaid" || order.paymentState === "failed") &&
                  order.paymentGateway !== "paymongo") ||
                (order.paymentState === "cod_due" && order.deliveryType === "pickup"));
            return (
              <Card key={order.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{order.customerName}</p>
                      <span className="text-xs text-muted-foreground">
                        · {relativeTime(order.createdAt)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BUCKET_STYLES[order.bucket]}`}
                      >
                        {statusLabel(order)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {order.orderNumber} ·{" "}
                      <a href={`tel:${order.customerPhone}`} className="hover:text-emerald-700">
                        {order.customerPhone}
                      </a>{" "}
                      · {order.deliveryType === "pickup" ? "Pickup" : "Delivery"} ·{" "}
                      {order.paymentMethod.toUpperCase()}
                      {order.paymentState === "cod_due" ? " (collect on delivery)" : ""}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{order.itemsSummary}</p>
                    {order.preorderShipDate ? (
                      <p className="mt-1 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300" data-testid="preorder-badge">
                        Pre-order — ships ~{order.preorderShipDate}
                      </p>
                    ) : null}
                    {((order.tags?.length ?? 0) > 0 || order.staffNote || order.edited || order.voided || Number(order.refundedAmount ?? 0) > 0 || order.invoiceNumber) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {(order.tags ?? []).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTagFilter(t)}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-emerald-200"
                          >
                            #{t}
                          </button>
                        ))}
                        {order.voided && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">Voided</span>}
                        {!order.voided && Number(order.refundedAmount ?? 0) > 0 && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">
                            Refunded {formatPrice(Number(order.refundedAmount))}
                          </span>
                        )}
                        {order.edited && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Edited</span>}
                        {order.invoiceNumber && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-muted-foreground">SI {order.invoiceNumber}</span>}
                        {order.staffNote && (
                          <span className="max-w-[16rem] truncate rounded-full bg-sky-50 px-2 py-0.5 text-sky-800 ring-1 ring-sky-200" title={order.staffNote}>
                            📝 {order.staffNote}
                          </span>
                        )}
                      </div>
                    )}
                    {sourceLabel(order) ? (
                      <p className="mt-1 inline-flex max-w-full items-center truncate rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {sourceLabel(order)}
                      </p>
                    ) : null}
                    {showProof ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        {order.paymentReference ? (
                          <p>
                            Ref: <span className="font-semibold">{order.paymentReference}</span>
                          </p>
                        ) : null}
                        {order.paymentProofUrl ? (
                          <a
                            href={order.paymentProofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block font-medium text-emerald-700 underline"
                          >
                            View payment screenshot
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-1 font-bold text-emerald-700">
                      {formatPrice(Number(order.total))}
                    </p>
                    {Number(order.giftCardAmount ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(Number(order.giftCardAmount ?? 0))} by gift card ·{" "}
                        {Number(order.total) - Number(order.giftCardAmount ?? 0) > 0.004
                          ? `${order.paymentMethod === "cod" ? "collect" : "due"} ${formatPrice(Number(order.total) - Number(order.giftCardAmount ?? 0))}`
                          : "fully paid"}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canConfirm && perms.can("orders.payments") && (
                      <button
                        onClick={() => confirmPayment(order)}
                        disabled={busy}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy ? "Confirming…" : order.paymentMethod === "cod" ? "Cash received" : "Confirm payment"}
                      </button>
                    )}
                    {order.paymentState === "pending_verification" && order.orderState === "open" && perms.can("orders.payments") && (
                      <button
                        onClick={() => {
                          if (window.confirm(`You didn't receive the payment for ${order.orderNumber}? The buyer will be asked to pay again.`)) {
                            void runAction(order, "reject_payment");
                          }
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      >
                        Not received
                      </button>
                    )}
                    {canBook(order) && (
                      <>
                        <button
                          onClick={() => {
                            setError(null);
                            setNotice(null);
                            setCompareOrder(order);
                          }}
                          className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
                        >
                          Book courier
                        </button>
                        <button
                          onClick={() => {
                            setAssignOrder(order);
                            setAssignForm({
                              courierLabel: "Angkas",
                              driverName: "",
                              driverPhone: "",
                              driverPlateNumber: "",
                              trackingUrl: "",
                            });
                          }}
                          className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                        >
                          Assign rider
                        </button>
                      </>
                    )}
                    {order.orderState === "open" && IN_TRANSIT.has(order.fulfillmentState) && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Did delivery of ${order.orderNumber} fail?`)) {
                            void runAction(order, "mark_failed_delivery");
                          }
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      >
                        Delivery failed
                      </button>
                    )}
                    {order.orderState === "open" && order.fulfillmentState === "failed_delivery" && (
                      <button
                        onClick={() => void runAction(order, "mark_returned")}
                        disabled={busy}
                        className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                      >
                        Item is back
                      </button>
                    )}
                    {canCancel(order) && perms.can("orders.cancel") && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Cancel order ${order.orderNumber}?`)) {
                            void runAction(order, "cancel", { reason: "Cancelled by seller" });
                          }
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      >
                        Cancel
                      </button>
                    )}
                    {canRefund(order) && perms.can("orders.refund") && (
                      <button
                        onClick={() => refundOrder(order)}
                        disabled={busy}
                        className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      >
                        Refund
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setToolsFor(order.id)}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                      More
                    </button>
                    {action && (
                      <Button size="sm" onClick={() => runAction(order, action.action)} disabled={busy}>
                        {busy ? "Saving..." : action.label}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {compareOrder && (
        <CourierCompare
          order={compareOrder}
          onClose={() => setCompareOrder(null)}
          onBooked={(message) => {
            setCompareOrder(null);
            setNotice(message);
            void load(true);
          }}
        />
      )}
      {assignOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl">
            <h3 className="font-display text-lg font-bold">Assign rider</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              For Angkas, Move It, Grab booked outside the app, or your own rider —{" "}
              {assignOrder.orderNumber}.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Courier
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.courierLabel}
                  onChange={(e) =>
                    setAssignForm((f) => ({ ...f, courierLabel: e.target.value }))
                  }
                >
                  <option>Angkas</option>
                  <option>Move It</option>
                  <option>Grab (manual)</option>
                  <option>Lalamove (manual)</option>
                  <option>Own rider</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Rider name
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.driverName}
                  onChange={(e) =>
                    setAssignForm((f) => ({ ...f, driverName: e.target.value }))
                  }
                  placeholder="Juan D."
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Rider phone
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.driverPhone}
                  onChange={(e) =>
                    setAssignForm((f) => ({ ...f, driverPhone: e.target.value }))
                  }
                  placeholder="09XXXXXXXXX"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Plate (optional)
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.driverPlateNumber}
                  onChange={(e) =>
                    setAssignForm((f) => ({ ...f, driverPlateNumber: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Tracking link (optional)
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.trackingUrl}
                  onChange={(e) =>
                    setAssignForm((f) => ({ ...f, trackingUrl: e.target.value }))
                  }
                  placeholder="https://"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                onClick={() => setAssignOrder(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignSaving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                onClick={() => submitAssignRider()}
              >
                {assignSaving ? "Saving…" : "Save rider"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
