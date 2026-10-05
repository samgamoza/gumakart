"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Slip {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  deliveryType: string;
  address: string | null;
  notes: string | null;
  staffNote: string | null;
  paymentMethod: string;
  collect: number;
  total: number;
  items: Array<{ title: string; quantity: number; sku: string | null }>;
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Phase 11: printable packing slips — one per page, black on white, no prices except COD to collect. */
export function PackingSlips() {
  const params = useSearchParams();
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [shop, setShop] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = params.get("ids") ?? "";
    fetch(`/api/orders/slips?ids=${encodeURIComponent(ids)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok: boolean; error?: string; slips?: Slip[]; shop?: string }) => {
        if (!d.ok) throw new Error(d.error ?? "Could not load the orders.");
        setSlips(d.slips ?? []);
        setShop(d.shop ?? "");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the orders."));
  }, [params]);

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`
        @media print { .no-print { display: none !important; } .slip { break-after: page; } body { background: #fff; } }
        @page { margin: 12mm; }
      `}</style>
      <div className="no-print sticky top-0 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3">
        <p className="text-sm text-gray-600">{slips ? `${slips.length} packing slip${slips.length === 1 ? "" : "s"}` : "Loading…"}</p>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white" disabled={!slips?.length}>
          Print
        </button>
      </div>
      {error && <p className="p-6 text-sm text-red-700">{error}</p>}
      <div className="mx-auto max-w-[720px] px-6 py-6">
        {slips?.map((s) => (
          <section key={s.id} className="slip mb-10 border border-black p-6" data-testid="packing-slip">
            <div className="flex items-start justify-between gap-4 border-b border-black pb-3">
              <div>
                <p className="text-xs uppercase tracking-widest">Packing slip</p>
                <p className="text-xl font-bold">{shop}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-bold">{s.orderNumber}</p>
                <p className="text-xs">{new Date(s.createdAt).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-600">{s.deliveryType === "pickup" ? "Pickup by" : "Deliver to"}</p>
                <p className="text-base font-semibold">{s.customerName}</p>
                <p>{s.customerPhone}</p>
                {s.deliveryType !== "pickup" && s.address && <p className="mt-1">{s.address}</p>}
              </div>
              <div className="text-right">
                {s.collect > 0 ? (
                  <div className="inline-block border-2 border-black px-3 py-2 text-left">
                    <p className="text-xs uppercase tracking-wide">Collect (COD)</p>
                    <p className="text-2xl font-bold">{peso(s.collect)}</p>
                  </div>
                ) : (
                  <p className="text-sm font-semibold">PAID · {s.paymentMethod.toUpperCase()}</p>
                )}
              </div>
            </div>
            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="w-10 py-1.5">✓</th>
                  <th className="py-1.5">Item</th>
                  <th className="py-1.5">SKU</th>
                  <th className="py-1.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((i, idx) => (
                  <tr key={idx} className="border-b border-gray-300">
                    <td className="py-2"><span className="inline-block h-4 w-4 border border-black" /></td>
                    <td className="py-2">{i.title}</td>
                    <td className="py-2 font-mono text-xs">{i.sku ?? ""}</td>
                    <td className="py-2 text-right text-base font-bold">{i.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(s.notes || s.staffNote) && (
              <div className="mt-4 space-y-1 text-sm">
                {s.notes && <p><span className="font-semibold">Buyer note:</span> {s.notes}</p>}
                {s.staffNote && <p><span className="font-semibold">Team note:</span> {s.staffNote}</p>}
              </div>
            )}
            <p className="mt-6 text-center text-xs text-gray-500">Salamat sa pag-order! · {shop}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
