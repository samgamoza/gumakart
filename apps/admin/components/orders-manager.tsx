"use client";

import { useShopRole } from "@/lib/use-shop-role";
import { OrderTools } from "@/components/order-tools";
import { CourierCompare } from "@/components/courier-compare";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, formatPrice } from "@gumakart/ui";
import { Link2, Loader2, NotebookPen, Phone, Printer, ReceiptText, X } from "lucide-react";
import { formatPhPhone, isValidPhMobile, paymentMethodLabel, telHref } from "@/lib/format-ph";

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

/** One line under the tabs: what this list is and what to do with it. */
const TAB_HINT: Record<TabId, string> = {
  all: "Every order, newest first. The coloured label on each card tells you what to do next.",
  to_pay: "Buyer hasn't paid yet. Nothing to do — they get a reminder if you turned it on in Auto SMS.",
  to_confirm: "Buyer says they paid. Check your GCash/Maya/bank app, then tap Confirm payment.",
  to_pack: "Paid or cash on delivery. Pack these, then tap Mark packed.",
  to_ship: "Packed and waiting. Book a courier, or assign your own rider.",
  shipping: "On the way. Mark delivered when the buyer has it.",
  attention: "Delivery failed or the item came back. Re-book, or mark the item as back in your shop.",
  done: "Delivered or picked up.",
  cancelled: "Cancelled orders. Paid ones still need a refund.",
};

const TAB_EMPTY: Partial<Record<TabId, string>> = {
  to_pay: "No unpaid orders.",
  to_confirm: "No payments to check. Nice.",
  to_pack: "Nothing to pack right now.",
  to_ship: "Nothing waiting for a rider.",
  shipping: "No orders on the way.",
  done: "No finished orders yet.",
};

/** Payment status in plain words, separate from where the parcel is. */
function paymentNote(order: OrderRow): { text: string; tone: "ok" | "warn" | "muted" } {
  switch (order.paymentState) {
    case "paid":
      return { text: "Paid", tone: "ok" };
    case "cod_due":
      return { text: "Collect on delivery", tone: "warn" };
    case "pending_verification":
      return { text: "Check payment", tone: "warn" };
    case "refunded":
      return { text: "Refunded", tone: "muted" };
    case "partially_refunded":
      return { text: "Partly refunded", tone: "muted" };
    case "failed":
      return { text: "Payment failed", tone: "warn" };
    default:
      return { text: "Not paid yet", tone: "muted" };
  }
}

const NOTE_TONE = {
  ok: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  muted: "text-muted-foreground",
} as const;

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
  to_pay: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
  to_confirm: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  to_pack: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
  to_ship: "bg-cyan-50 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-200",
  shipping: "bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
  attention: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
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

/** Phase 24: couriers that give a waybill number (must match the assign-rider API list). */
const PARCEL_COURIERS: string[] = ["J&T Express", "LBC", "Flash Express", "Ninja Van", "2GO", "Other courier"];

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
  /** Phase 24: orders ticked for batch printing / packing (To pack and To ship tabs). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => setSelected(new Set()), [tab]);
  const [tagFilter, setTagFilter] = useState("");
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  // Dashboard to-do tiles link here as /orders?tab=to_confirm etc.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.id === wanted)) setTab(wanted as TabId);
  }, []);
  /** Keep the tab in the address bar so refresh, back and shared links land on the same list. */
  function chooseTab(next: TabId) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* non-browser */
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /** Phase 33 (H7): the order whose courier prices are being compared. */
  const [compareOrder, setCompareOrder] = useState<OrderRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignOrder, setAssignOrder] = useState<OrderRow | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  /** Errors for the rider dialog are shown inside it, not on the page behind the overlay. */
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({
    courierLabel: "Angkas",
    driverName: "",
    driverPhone: "",
    driverPlateNumber: "",
    trackingUrl: "",
    trackingNumber: "",
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

  /** Phase 24: mark the ticked orders packed in one go (each through the normal order service). */
  async function markSelectedPacked() {
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_ready", orderIds: [...selected] }),
      });
      const d = await res.json();
      if (!d.ok) {
        setError(d.error ?? "Could not update the orders.");
        return;
      }
      const skipped = (d.skipped as Array<{ orderNumber: string; reason: string }>) ?? [];
      setNotice(
        `${d.done.length} order${d.done.length === 1 ? "" : "s"} marked packed.` +
          (skipped.length ? ` Not changed: ${skipped.map((x) => `${x.orderNumber} (${x.reason})`).join(", ")}.` : "")
      );
      setSelected(new Set());
      await load(true);
    } catch {
      setError("Network error while updating the orders.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitAssignRider() {
    if (!assignOrder) return;
    setAssignError(null);
    const parcel = PARCEL_COURIERS.includes(assignForm.courierLabel);
    if (parcel && assignForm.trackingNumber.replace(/\s+/g, "").length < 6) {
      setAssignError("Enter the waybill or tracking number from the courier's receipt.");
      return;
    }
    if (!parcel && assignForm.driverName.trim().length < 2) {
      setAssignError("Enter the rider's name so the buyer knows who's coming.");
      return;
    }
    if (!parcel && assignForm.driverPhone.trim() && !isValidPhMobile(assignForm.driverPhone)) {
      setAssignError("Rider phone should be an 11-digit mobile number, like 0917 123 4567.");
      return;
    }
    if (assignForm.trackingUrl.trim() && !/^https?:\/\//i.test(assignForm.trackingUrl.trim())) {
      setAssignError("The tracking link should start with https://");
      return;
    }
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
        setAssignError(data.error ?? "Could not save rider. Your details are still here — try again.");
        return;
      }
      setNotice(
        PARCEL_COURIERS.includes(assignForm.courierLabel)
          ? `${assignOrder.orderNumber} shipped via ${assignForm.courierLabel} · ${assignForm.trackingNumber.replace(/\s+/g, "").toUpperCase()}.`
          : `Rider ${assignForm.driverName} assigned on ${assignOrder.orderNumber} (${assignForm.courierLabel}).`
      );
      setAssignOrder(null);
      await load(true);
    } catch {
      setAssignError("No connection. Your details are still here — try again when you're back online.");
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
      <div
        className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0"
        role="toolbar"
        aria-label="Order lists"
      >
        {TABS.map((tabDef) => {
          const count = counts.get(tabDef.id) ?? 0;
          if ((tabDef.id === "cancelled" || tabDef.id === "attention") && count === 0) return null;
          const on = tab === tabDef.id;
          const urgent = count > 0 && (tabDef.id === "to_confirm" || tabDef.id === "to_pack" || tabDef.id === "to_ship" || tabDef.id === "attention");
          return (
            <button
              key={tabDef.id}
              type="button"
              aria-pressed={on}
              onClick={() => chooseTab(tabDef.id)}
              className={`inline-flex min-h-[40px] shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                on
                  ? "bg-violet-600 text-white shadow-sm shadow-violet-600/20 dark:bg-violet-500"
                  : "bg-card text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-white/10 dark:hover:bg-white/[0.04]"
              }`}
            >
              {tabDef.label}
              {count > 0 && tabDef.id !== "all" && (
                <span
                  className={`ml-1.5 min-w-[1.25rem] rounded-full px-1.5 text-center text-xs font-bold ${
                    on ? "bg-white/25 text-white" : urgent ? "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{TAB_HINT[tab]}</p>

      {(allTags.length > 0 || ((tab === "to_pack" || tab === "to_ship") && slipIds.length > 0)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {allTags.length > 0 && (
            <select
              className="h-10 rounded-lg border border-border bg-card px-2 text-sm"
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
            <div className="flex flex-wrap items-center gap-2" data-testid="batch-bar">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-violet-600"
                  checked={selected.size > 0 && slipIds.every((id) => selected.has(id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(slipIds) : new Set())}
                  aria-label="Select all"
                  data-testid="select-all"
                />
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </label>
              <a
                href={`/orders/slips?pick=1&ids=${(selected.size ? [...selected] : slipIds).join(",")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
                data-testid="print-batch"
              >
                <Printer className="h-4 w-4" aria-hidden /> Pick list + slips ({selected.size || slipIds.length})
              </a>
              {tab === "to_pack" && selected.size > 0 && (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void markSelectedPacked()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  data-testid="bulk-packed"
                >
                  {bulkBusy ? "Saving…" : `Mark ${selected.size} packed`}
                </button>
              )}
            </div>
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

      <div aria-live="polite" className="contents">
        {error && (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="shrink-0 font-semibold underline underline-offset-2">
              Retry
            </button>
          </div>
        )}
        {notice && (
          <div className="gk-rise mb-4 flex items-start justify-between gap-3 break-words rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            <span className="min-w-0">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-1 shrink-0 rounded p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="text-center">
          <ReceiptText className="mx-auto h-9 w-9 text-violet-500" aria-hidden />
          <h2 className="mt-3 font-semibold">
            {orders.length === 0 ? "No orders yet" : TAB_EMPTY[tab] ?? "Nothing here right now"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {orders.length === 0
              ? "Share a checkout link in your Facebook post, TikTok bio or Messenger chat. Orders appear here the moment a buyer checks out."
              : tagFilter
                ? `No orders tagged #${tagFilter} in this list.`
                : "Orders move here on their own as they reach this step."}
          </p>
          {orders.length === 0 ? (
            <Link
              href="/checkout-links"
              className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"
            >
              <Link2 className="h-4 w-4" aria-hidden /> Make a checkout link
            </Link>
          ) : tab !== "all" || tagFilter ? (
            <button
              type="button"
              onClick={() => {
                setTagFilter("");
                chooseTab("all");
              }}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted"
            >
              Show all orders
            </button>
          ) : null}
        </Card>
      ) : (
        <ul className="space-y-3">
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
            const confirmAllowed = canConfirm && perms.can("orders.payments");
            // Only promote "Confirm payment" when there's something to check (proof sent, or cash at pickup).
            // An unpaid order with no proof keeps the button, but as a secondary one.
            const confirmIsNext =
              confirmAllowed &&
              (order.paymentState === "pending_verification" ||
                (order.paymentState === "cod_due" && order.fulfillmentState === "ready"));
            const bookable = canBook(order);
            // One prominent next step per card; the rest are secondary or quiet.
            const primary: "confirm" | "next" | "book" | null = confirmIsNext
              ? "confirm"
              : action
                ? "next"
                : bookable
                  ? "book"
                  : null;
            const pay = paymentNote(order);
            const giftCard = Number(order.giftCardAmount ?? 0);
            const due = Number(order.total) - giftCard;
            const source = sourceLabel(order);
            const openBook = () => {
              setError(null);
              setNotice(null);
              setCompareOrder(order);
            };
            const openAssign = () => {
              setAssignError(null);
              setAssignOrder(order);
              setAssignForm({
                courierLabel: "Angkas",
                driverName: "",
                driverPhone: "",
                driverPlateNumber: "",
                trackingUrl: "",
                trackingNumber: "",
              });
            };
            const primaryBtn =
              "inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-60 sm:w-auto";
            const secondaryBtn =
              "inline-flex min-h-[40px] items-center rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50";
            const quietBtn =
              "inline-flex min-h-[40px] items-center rounded-xl px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-300";
            return (
              <li key={order.id}>
              <Card className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      {(tab === "to_pack" || tab === "to_ship") && order.orderState !== "cancelled" && (
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 shrink-0 accent-violet-600"
                          aria-label={`Select ${order.orderNumber}`}
                          checked={selected.has(order.id)}
                          onChange={(e) =>
                            setSelected((cur) => {
                              const next = new Set(cur);
                              if (e.target.checked) next.add(order.id);
                              else next.delete(order.id);
                              return next;
                            })
                          }
                          data-testid="order-select"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="truncate text-base font-semibold">{order.customerName}</p>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BUCKET_STYLES[order.bucket]}`}
                          >
                            {statusLabel(order)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {order.orderNumber} · {relativeTime(order.createdAt)} ·{" "}
                          {order.deliveryType === "pickup" ? "Pickup" : "Delivery"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm text-foreground/90">{order.itemsSummary}</p>

                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-display text-xl font-bold tracking-tight text-foreground">
                        {formatPrice(Number(order.total))}
                      </span>
                      <span className="text-sm text-muted-foreground">{paymentMethodLabel(order.paymentMethod)}</span>
                      {/* The status label already says "Check payment" / "Waiting for payment" in those lists. */}
                      {order.bucket !== "to_confirm" && order.bucket !== "to_pay" && (
                        <span className={`text-sm font-semibold ${NOTE_TONE[pay.tone]}`}>{pay.text}</span>
                      )}
                    </div>
                    {giftCard > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(giftCard)} by gift card ·{" "}
                        {due > 0.004
                          ? `${order.paymentMethod === "cod" ? "collect" : "due"} ${formatPrice(due)}`
                          : "fully paid"}
                      </p>
                    )}

                    <a
                      href={telHref(order.customerPhone)}
                      className="mt-2 inline-flex min-h-[32px] items-center gap-1.5 text-sm text-muted-foreground hover:text-violet-700 dark:hover:text-violet-300"
                      aria-label={`Call ${order.customerName} at ${formatPhPhone(order.customerPhone)}`}
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      {formatPhPhone(order.customerPhone)}
                    </a>

                    {order.preorderShipDate ? (
                      <p className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-testid="preorder-badge">
                        Pre-order — ships ~{order.preorderShipDate}
                      </p>
                    ) : null}
                    {((order.tags?.length ?? 0) > 0 || order.staffNote || order.edited || order.voided || Number(order.refundedAmount ?? 0) > 0 || order.invoiceNumber) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {(order.tags ?? []).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTagFilter(t)}
                            aria-label={`Show only orders tagged ${t}`}
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
                          <span className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full bg-sky-50 px-2 py-0.5 text-sky-800 ring-1 ring-sky-200" title={order.staffNote}>
                            <NotebookPen className="h-3 w-3 shrink-0" aria-hidden /> {order.staffNote}
                          </span>
                        )}
                      </div>
                    )}
                    {source ? (
                      <p className="mt-1.5 flex w-fit max-w-full items-center truncate rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200">
                        {source}
                      </p>
                    ) : null}
                    {showProof ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Buyer&apos;s payment proof</p>
                        {order.paymentReference ? (
                          <p className="mt-0.5">
                            Reference no. <span className="font-mono font-semibold">{order.paymentReference}</span>
                          </p>
                        ) : null}
                        {order.paymentProofUrl ? (
                          <a
                            href={order.paymentProofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex min-h-[32px] items-center font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300"
                          >
                            View payment screenshot
                          </a>
                        ) : null}
                        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-100/80">
                          Match the amount and reference in your {paymentMethodLabel(order.paymentMethod)} app before confirming.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto lg:max-w-[22rem] lg:items-end">
                    {primary === "confirm" && (
                      <button type="button" onClick={() => confirmPayment(order)} disabled={busy} className={primaryBtn}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {busy ? "Confirming…" : order.paymentMethod === "cod" ? "Cash received" : "Confirm payment"}
                      </button>
                    )}
                    {primary === "next" && action && (
                      <button type="button" onClick={() => runAction(order, action.action)} disabled={busy} className={primaryBtn}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {busy ? "Saving…" : action.label}
                      </button>
                    )}
                    {primary === "book" && (
                      <button type="button" onClick={openBook} className={primaryBtn}>
                        Book courier
                      </button>
                    )}

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {confirmAllowed && primary !== "confirm" && (
                        <button type="button" onClick={() => confirmPayment(order)} disabled={busy} className={secondaryBtn}>
                          {order.paymentMethod === "cod" ? "Cash received" : "Mark as paid"}
                        </button>
                      )}
                      {primary !== "confirm" && primary !== "next" && action && (
                        <button type="button" onClick={() => runAction(order, action.action)} disabled={busy} className={secondaryBtn}>
                          {action.label}
                        </button>
                      )}
                      {bookable && primary !== "book" && (
                        <button type="button" onClick={openBook} className={secondaryBtn}>
                          Book courier
                        </button>
                      )}
                      {bookable && (
                        <button type="button" onClick={openAssign} className={secondaryBtn}>
                          Assign own rider
                        </button>
                      )}
                      {order.orderState === "open" && order.fulfillmentState === "failed_delivery" && (
                        <button type="button" onClick={() => void runAction(order, "mark_returned")} disabled={busy} className={secondaryBtn}>
                          Item is back
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setToolsFor(order.id)}
                        className={secondaryBtn}
                        aria-label={`More for order ${order.orderNumber}: edit, notes, receipt`}
                      >
                        More
                      </button>
                    </div>

                    {/* Less common and destructive actions stay quiet, away from the main button. */}
                    {(order.paymentState === "pending_verification" && order.orderState === "open" && perms.can("orders.payments")) ||
                    (order.orderState === "open" && IN_TRANSIT.has(order.fulfillmentState)) ||
                    (canCancel(order) && perms.can("orders.cancel")) ||
                    (canRefund(order) && perms.can("orders.refund")) ? (
                      <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                        {order.paymentState === "pending_verification" && order.orderState === "open" && perms.can("orders.payments") && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`You didn't receive the payment for ${order.orderNumber}? The buyer will be asked to pay again.`)) {
                                void runAction(order, "reject_payment");
                              }
                            }}
                            disabled={busy}
                            className={quietBtn}
                          >
                            Payment not received
                          </button>
                        )}
                        {order.orderState === "open" && IN_TRANSIT.has(order.fulfillmentState) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Did delivery of ${order.orderNumber} fail?`)) {
                                void runAction(order, "mark_failed_delivery");
                              }
                            }}
                            disabled={busy}
                            className={quietBtn}
                          >
                            Delivery failed
                          </button>
                        )}
                        {canCancel(order) && perms.can("orders.cancel") && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Cancel order ${order.orderNumber}?`)) {
                                void runAction(order, "cancel", { reason: "Cancelled by seller" });
                              }
                            }}
                            disabled={busy}
                            className={quietBtn}
                          >
                            Cancel order
                          </button>
                        )}
                        {canRefund(order) && perms.can("orders.refund") && (
                          <button type="button" onClick={() => refundOrder(order)} disabled={busy} className={quietBtn}>
                            Refund
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
              </li>
            );
          })}
        </ul>
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
        <AssignRiderDialog onClose={() => setAssignOrder(null)}>
            <h3 id="assign-rider-title" className="font-display text-lg font-bold">Assign your own rider or courier</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              For Angkas, Move It, Grab booked outside the app, your own rider, or a parcel courier ·{" "}
              {assignOrder.orderNumber}
            </p>
            {assignError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
                {assignError}
              </p>
            )}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitAssignRider();
              }}
            >
              <label className="block text-sm font-medium text-foreground">
                Courier
                <select
                  className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
                  value={assignForm.courierLabel}
                  onChange={(e) => {
                    setAssignError(null);
                    setAssignForm((f) => ({ ...f, courierLabel: e.target.value }));
                  }}
                >
                  <option>Angkas</option>
                  <option>Move It</option>
                  <option>Grab (manual)</option>
                  <option>Lalamove (manual)</option>
                  <option>Own rider</option>
                  <option>Other</option>
                  <optgroup label="Parcel couriers (waybill)">
                    {PARCEL_COURIERS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              {PARCEL_COURIERS.includes(assignForm.courierLabel) ? (
                <label className="block text-sm font-medium text-foreground">
                  Waybill / tracking number
                  <input
                    className="mt-1 h-11 w-full rounded-lg border border-border px-3 font-mono text-sm uppercase"
                    value={assignForm.trackingNumber}
                    onChange={(e) => setAssignForm((f) => ({ ...f, trackingNumber: e.target.value }))}
                    placeholder="e.g. 7801234567890"
                    autoComplete="off"
                    required
                    data-testid="tracking-number"
                  />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">The buyer gets it by text and on their order page.</span>
                </label>
              ) : (
                <>
                  <label className="block text-sm font-medium text-foreground">
                    Rider name
                    <input
                      className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
                      value={assignForm.driverName}
                      onChange={(e) => setAssignForm((f) => ({ ...f, driverName: e.target.value }))}
                      placeholder="Juan D."
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    Rider mobile <span className="font-normal text-muted-foreground">(optional)</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
                      value={assignForm.driverPhone}
                      onChange={(e) => setAssignForm((f) => ({ ...f, driverPhone: e.target.value }))}
                      onBlur={(e) => {
                        if (isValidPhMobile(e.target.value)) setAssignForm((f) => ({ ...f, driverPhone: formatPhPhone(e.target.value) }));
                      }}
                      placeholder="0917 123 4567"
                      autoComplete="off"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-foreground">
                      Plate <span className="font-normal text-muted-foreground">(optional)</span>
                      <input
                        className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm uppercase"
                        value={assignForm.driverPlateNumber}
                        onChange={(e) => setAssignForm((f) => ({ ...f, driverPlateNumber: e.target.value }))}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block text-sm font-medium text-foreground">
                      Tracking link <span className="font-normal text-muted-foreground">(optional)</span>
                      <input
                        type="url"
                        inputMode="url"
                        className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
                        value={assignForm.trackingUrl}
                        onChange={(e) => setAssignForm((f) => ({ ...f, trackingUrl: e.target.value }))}
                        placeholder="https://"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-muted-foreground hover:bg-muted"
                  onClick={() => setAssignOrder(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignSaving}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {assignSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {assignSaving ? "Saving…" : "Save rider"}
                </button>
              </div>
            </form>
        </AssignRiderDialog>
      )}
    </>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens; Escape and the backdrop close it. */
function AssignRiderDialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-rider-title"
        onClick={(e) => e.stopPropagation()}
        className="gk-rise max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:pb-5"
      >
        {children}
      </div>
    </div>
  );
}
