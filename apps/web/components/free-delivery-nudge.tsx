"use client";

import { Truck } from "lucide-react";
import { freeDeliveryNudge } from "@gumakart/db/shipping";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Phase 17b: "Dagdagan ng ₱X para LIBRE ang delivery" with a progress bar.
 * Shows nothing when the shop has no free-delivery minimum.
 */
export function FreeDeliveryNudge({
  subtotal,
  freeAbove,
  className = "",
}: {
  subtotal: number;
  freeAbove: number | null | undefined;
  className?: string;
}) {
  const n = freeDeliveryNudge(subtotal, freeAbove);
  if (!n) return null;
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 text-sm ${n.reached ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"} ${className}`}
      data-testid="free-delivery-nudge"
      role="status"
    >
      <p className="flex items-center gap-2 font-medium">
        <Truck className="h-4 w-4 shrink-0" aria-hidden />
        {n.reached ? (
          <span>Libre na ang delivery mo!</span>
        ) : (
          <span>
            Dagdagan ng <strong>{peso(n.remaining)}</strong> para <strong>LIBRE</strong> ang delivery.
          </span>
        )}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10" aria-hidden>
        <div className={`h-full rounded-full ${n.reached ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.round(n.progress * 100)}%` }} />
      </div>
      {!n.reached && <p className="mt-1 text-xs opacity-80">Libre ang delivery sa {peso(n.threshold)} pataas.</p>}
    </div>
  );
}
