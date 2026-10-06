"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@gumakart/ui";

type Option = {
  provider: "lalamove" | "grab" | "bayango" | "manual";
  label: string;
  fee: number;
  etaMinutes: number | null;
  distanceKm: number | null;
  recommended: boolean;
  cheapest: boolean;
};

/**
 * Phase 33 (H7): courier prices side by side for one order. The seller books the one they pick;
 * prices are the couriers' live quotes (they can change by the time a rider is booked).
 */
export function CourierCompare({
  order,
  onClose,
  onBooked,
}: {
  order: { id: string; orderNumber: string };
  onClose: () => void;
  onBooked: (message: string) => void;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [unavailable, setUnavailable] = useState<Array<{ label: string; reason: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/delivery-quotes`, { method: "POST" });
        const data = await res.json();
        if (!live) return;
        if (!data.ok) setError(data.error ?? "Could not get courier prices.");
        else {
          setOptions(data.options);
          setUnavailable(data.unavailable ?? []);
        }
      } catch {
        if (live) setError("Network error while getting courier prices.");
      }
    })();
    return () => {
      live = false;
    };
  }, [order.id]);

  async function book(option: Option) {
    setBooking(option.provider);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/book-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: option.provider }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? `${option.label} couldn't take this booking. Try another courier.`);
        return;
      }
      const fee = formatPrice(Number(data.delivery.fee ?? option.fee));
      onBooked(
        data.delivery.trackingUrl
          ? `${option.label} booked for ${order.orderNumber} (${fee}). Track: ${data.delivery.trackingUrl}`
          : `${option.label} booked for ${order.orderNumber} (${fee}).`
      );
    } catch {
      setError("Network error while booking.");
    } finally {
      setBooking(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" data-testid="courier-compare">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl">
        <h3 className="font-display text-lg font-bold">Compare couriers</h3>
        <p className="mt-1 text-sm text-muted-foreground">Live prices for {order.orderNumber}. Pick one to book.</p>

        {!options && !error && <p className="mt-4 text-sm text-muted-foreground">Asking the couriers…</p>}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {options && options.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">No courier could quote this route. Use Assign rider instead.</p>
        )}

        {options && options.length > 0 && (
          <ul className="mt-4 space-y-2">
            {options.map((o) => (
              <li key={o.provider} className="flex items-center gap-3 rounded-xl border border-border p-3" data-testid={`quote-${o.provider}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {o.label}
                    {o.recommended && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Fastest</span>}
                    {o.cheapest && <span className="ml-2 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">Cheapest</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[o.etaMinutes != null ? `~${o.etaMinutes} min` : "You arrange the ride", o.distanceKm != null ? `${o.distanceKm} km` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="text-sm font-bold tabular-nums">{formatPrice(o.fee)}</p>
                <button
                  onClick={() => book(o)}
                  disabled={booking !== null}
                  className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
                >
                  {booking === o.provider ? "Booking…" : "Book"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {unavailable.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Not available: {unavailable.map((u) => `${u.label} (${u.reason})`).join(" · ")}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
