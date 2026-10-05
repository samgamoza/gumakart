"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@gumakart/ui";
import { normalizePlanId, planDisplayName } from "@gumakart/plans";

/** Phase 16 — when the plan renews or ends, the grace period, and past payments with receipts. */

interface Overview {
  status: { plan: string; state: "free" | "manual" | "active" | "expiring" | "grace"; expiresAt: string | null; daysLeft: number | null; graceEndsAt: string | null };
  payments: Array<{ id: string; plan: string; amount: string; status: string; receiptNumber: string | null; createdAt: string; paidAt: string | null }>;
  billingEnabled: boolean;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" }) : "—");
const peso = (v: string) => `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "")}`;

export function BillingStatus({ onRenew, renewing }: { onRenew: (plan: "growth" | "pro") => void; renewing: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    void fetch("/api/billing/overview", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Overview & { ok: boolean }) => d.ok && setData(d));
  }, []);
  if (!data) return null;
  const s = data.status;
  const plan = planDisplayName(normalizePlanId(s.plan));
  const renewable = (s.plan === "growth" || s.plan === "pro") && data.billingEnabled;
  const tone =
    s.state === "grace"
      ? "border-red-400/60 bg-red-500/10 text-red-100"
      : s.state === "expiring"
        ? "border-amber-400/60 bg-amber-500/10 text-amber-100"
        : "border-white/10 bg-white/[0.03]";

  return (
    <div className="mb-4 space-y-4" data-testid="billing-status">
      {s.state !== "free" && (
        <Card className={`p-5 ${tone}`}>
          {s.state === "manual" ? (
            <p className="text-sm">
              Your {plan} plan was set up by Guma Kart and has no end date.
            </p>
          ) : s.state === "grace" ? (
            <>
              <p className="font-semibold">Your {plan} plan ended on {day(s.expiresAt)}.</p>
              <p className="mt-1 text-sm">
                Everything stays on until <b>{day(s.graceEndsAt)}</b> ({s.daysLeft} day{s.daysLeft === 1 ? "" : "s"} left). After that the shop moves to Free — nothing is deleted.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">
                {plan} plan · {s.state === "expiring" ? `ends in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}` : "active"}
              </p>
              <p className="mt-1 text-sm">Paid through {day(s.expiresAt)}. Renewing early adds 30 days to that date.</p>
            </>
          )}
          {renewable && s.state !== "manual" && (
            <button
              type="button"
              disabled={renewing}
              onClick={() => onRenew(s.plan as "growth" | "pro")}
              className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {renewing ? "Opening payment…" : `Renew ${plan} — 30 days`}
            </button>
          )}
        </Card>
      )}

      {data.payments.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold">Payments</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="font-medium">Plan</th>
                  <th className="font-medium">Amount</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{day(p.paidAt ?? p.createdAt)}</td>
                    <td>{planDisplayName(normalizePlanId(p.plan))}</td>
                    <td>{peso(p.amount)}</td>
                    <td className="capitalize">{p.status === "pending" ? "Not completed" : p.status}</td>
                    <td>
                      {p.status === "paid" ? (
                        <Link className="text-emerald-600 underline" href={`/settings/subscription/receipt/${p.id}`}>
                          {p.receiptNumber ?? "View"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
