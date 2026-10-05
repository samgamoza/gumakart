"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { normalizePlanId, planDisplayName } from "@gumakart/plans";

interface Receipt {
  id: string;
  plan: string;
  amount: string;
  periodDays: number;
  receiptNumber: string | null;
  paidAt: string | null;
  shopName: string;
  legalName: string | null;
  shopSlug: string;
}

/**
 * Phase 16 — printable payment receipt for a plan payment. It is an acknowledgement of
 * payment, not a BIR official receipt (Guma Kart's own BIR registration is pending).
 */
export default function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = use(params);
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch(`/api/billing/receipts/${paymentId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((d: { ok: boolean; receipt?: Receipt; error?: string }) => (d.ok && d.receipt ? setR(d.receipt) : setError(d.error ?? "Not found.")));
  }, [paymentId]);

  if (error) return <p className="p-8 text-sm">{error}</p>;
  if (!r) return <p className="p-8 text-sm">Loading…</p>;
  const amount = Number(r.amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="min-h-screen bg-white p-6 text-slate-900 print:p-0">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 p-8 print:border-0" data-testid="plan-receipt">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold">Guma Kart</p>
            <p className="text-xs text-slate-500">guma.one · support@guma.one</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">Payment receipt</p>
            <p className="font-mono text-sm">{r.receiptNumber ?? r.id.slice(0, 8)}</p>
          </div>
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">Billed to</dt>
          <dd>{r.legalName || r.shopName}</dd>
          <dt className="text-slate-500">Shop</dt>
          <dd>{r.shopSlug}</dd>
          <dt className="text-slate-500">Paid on</dt>
          <dd>{r.paidAt ? new Date(r.paidAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }) : "—"}</dd>
        </dl>
        <table className="mt-8 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-3">
                Guma Kart {planDisplayName(normalizePlanId(r.plan))} plan — {r.periodDays} days
              </td>
              <td className="py-3 text-right">₱{amount}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 font-semibold">Total paid</td>
              <td className="pt-3 text-right font-semibold">₱{amount}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-8 text-xs text-slate-500">
          This acknowledges your payment. It is not a BIR official receipt; an official receipt will be issued once Guma Kart&apos;s BIR registration is
          complete.
        </p>
        <div className="mt-6 flex gap-3 print:hidden">
          <button type="button" onClick={() => window.print()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Print / save as PDF
          </button>
          <Link href="/settings/subscription" className="rounded-xl border border-slate-200 px-4 py-2 text-sm">
            Back
          </Link>
        </div>
      </div>
    </div>
  );
}
