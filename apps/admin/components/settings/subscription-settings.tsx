"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "@gumakart/ui";
import { SELLER_PLANS, normalizePlanId, planDisplayName } from "@gumakart/plans";
import { SettingsShell } from "@/components/settings/settings-shell";
import { BillingStatus } from "@/components/settings/billing-status";
import { useTenantSettings } from "@/components/settings/settings-forms";
import { modelStoreUrl } from "@/lib/utils";

const PLANS = SELLER_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  price: p.priceMonthly === 0 ? "₱0" : `₱${p.priceMonthly}/mo`,
  features: p.marketingFeatures,
}));

const PAY_METHODS = [
  { id: "gcash", label: "GCash" },
  { id: "paymaya", label: "Maya" },
  { id: "card", label: "Card" },
] as const;

const SUPPORT_EMAIL = "support@guma.one";

/**
 * Paid plans need PayMongo plus Guma One's business and BIR registration
 * (on hold). Until NEXT_PUBLIC_PLAN_BILLING_ENABLED=true, upgrades show "coming
 * soon" instead of opening a payment that can't complete.
 */
const PLAN_BILLING_ENABLED = process.env.NEXT_PUBLIC_PLAN_BILLING_ENABLED === "true";

export function SubscriptionSettingsPage() {
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight");
  const refSource = searchParams.get("ref") ?? searchParams.get("from");
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const { settings, loading, error } = useTenantSettings();
  const currentPlan = normalizePlanId(settings?.subscriptionPlan);
  const [method, setMethod] = useState<(typeof PAY_METHODS)[number]["id"]>("gcash");
  const [payingPlan, setPayingPlan] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (highlight !== "growth" && highlight !== "pro") return;
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, loading]);
  async function upgrade(plan: "growth" | "pro") {
    setPayingPlan(plan);
    setPayError(null);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, method }),
      });
      const data = await res.json();
      if (!data.ok) {
        setPayError(data.error ?? "Could not start the payment.");
        return;
      }
      if (data.redirectUrl) {
        // PayMongo hosted payment page; the webhook applies the plan on success.
        window.location.href = data.redirectUrl;
        return;
      }
      setPayError("Payment started, but no payment page was returned. Contact support.");
    } catch {
      setPayError("Network error. Check your connection and try again.");
    } finally {
      setPayingPlan(null);
    }
  }

  if (loading) {
    return <SettingsShell title="Subscription" description="Loading…">…</SettingsShell>;
  }

  return (
    <SettingsShell
      title="Subscription"
      description="Your current Guma One plan and available upgrades."
    >
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {payError && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {payError}
        </p>
      )}

      <Card className="mb-4 border-emerald-500/30 bg-emerald-500/10 p-5">
        <p className="text-sm text-muted-foreground">Current plan</p>
        <p className="mt-1 text-2xl font-bold text-emerald-300">
          {planDisplayName(currentPlan)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Shop status: <span className="font-medium capitalize">{settings?.status}</span>
        </p>
      </Card>

      <BillingStatus onRenew={(p) => void upgrade(p)} renewing={payingPlan !== null} />

      {currentPlan === "free" && (
        <Card className="mb-4 border-amber-200 bg-gradient-to-r from-amber-50 to-white p-5">
          <p className="font-semibold text-amber-900">Not sure which plan fits?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tour our flagship model store — live selling unlocks on Pro; flash deals and reviews are
            labeled by plan tier so you know exactly what you&apos;re unlocking.
          </p>
          <a
            href={modelStoreUrl(refSource ? `subscription-${refSource}` : "subscription")}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-200"
          >
            Open model store ↗
          </a>
        </Card>
      )}

      {refSource && (
        <p className="mb-4 text-xs text-muted-foreground">
          You arrived from the model store ({refSource.replace(/-/g, " ")}). Pick a plan below to
          unlock those features on your shop.
        </p>
      )}

      {!PLAN_BILLING_ENABLED && (
        <div className="mb-4 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <p className="font-semibold">Paid plans are coming soon</p>
          <p className="mt-1">
            During the beta every shop runs on the plan shown as current. We&apos;ll let you know
            when upgrades open.
          </p>
        </div>
      )}

      <div className={`mb-4 flex items-center gap-2 ${PLAN_BILLING_ENABLED ? "" : "hidden"}`}>
        <span className="text-sm text-muted-foreground">Pay with:</span>
        {PAY_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMethod(m.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              method === m.id
                ? "bg-emerald-600 text-white"
                : "bg-muted text-muted-foreground hover:bg-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div ref={highlightRef} className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const active = plan.id === currentPlan;
          const highlighted = highlight === plan.id;
          return (
            <Card
              key={plan.id}
              className={`p-5 transition ${
                active
                  ? "ring-2 ring-emerald-500"
                  : highlighted
                    ? "ring-2 ring-amber-400 shadow-lg shadow-amber-100"
                    : ""
              }`}
            >              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{plan.name}</h3>
                {active && <Badge className="bg-emerald-100 text-emerald-800">Current</Badge>}
                {!active && highlighted && (
                  <Badge className="bg-amber-100 text-amber-800">Recommended</Badge>
                )}
              </div>              <p className="mt-2 text-2xl font-bold">{plan.price}</p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              {!active && plan.id !== "free" && !PLAN_BILLING_ENABLED && (
                <Button className="mt-4 w-full" type="button" variant="secondary" disabled>
                  Coming soon
                </Button>
              )}
              {!active && plan.id !== "free" && PLAN_BILLING_ENABLED && (
                <Button
                  className="mt-4 w-full"
                  type="button"
                  disabled={payingPlan !== null}
                  onClick={() => {
                    if (plan.id === "growth" || plan.id === "pro") upgrade(plan.id);
                  }}
                >
                  {payingPlan === plan.id ? "Opening payment…" : `Upgrade — ${plan.price}`}
                </Button>
              )}
              {!active && plan.id === "free" && (
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Downgrade to Free")}`}
                  className="mt-4 block"
                >
                  <Button className="w-full" variant="secondary" type="button">
                    Contact us to downgrade
                  </Button>
                </a>
              )}
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Each payment adds 30 days (GCash, Maya or card via PayMongo); we remind you 7, 3 and 1 day before it ends, and
        everything stays on for 7 days after. Your upgrade activates the moment your payment is confirmed. Questions? Email {SUPPORT_EMAIL}.
      </p>
    </SettingsShell>
  );
}
