import Link from "next/link";
import { ArrowRight, Check, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { SELLER_PLANS, PLAN_AI_LIMITS } from "@gumakart/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminUrl } from "@/lib/utils";

const plans = SELLER_PLANS.map((plan) => {
  const limits = PLAN_AI_LIMITS[plan.id];
  return {
    id: plan.id,
    name: plan.name,
    price: plan.priceMonthly === 0 ? "₱0" : `₱${plan.priceMonthly}`,
    period: "/month",
    desc: plan.tagline,
    features: plan.marketingFeatures.length
      ? plan.marketingFeatures
      : [
          `${limits.generationsPerMonth} AI generations / month`,
          ...plan.features,
        ],
    cta: plan.id === "free" ? "Start free" : plan.id === "growth" ? "Get Pro" : "Talk to sales",
    href: plan.id === "pro" ? "/contact" : `${adminUrl}/signup`,
    highlighted: plan.id === "growth",
  };
});

export function LandingPricing() {
  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Pricing</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Start free. Scale when you&apos;re ready.
          </h2>
          <p className="mt-4 text-muted-foreground">
            No setup fees. No per-order fee on cash on delivery or payments sent straight to your own GCash/Maya. Online payments collected through Guma carry a small fee.
          </p>
        </div>

        <Link
          href="/model?ref=pricing"
          className="mx-auto mt-10 flex max-w-2xl items-center gap-4 rounded-2xl border border-primary/25 bg-gradient-to-r from-emerald-50 to-amber-50/80 p-4 transition hover:border-primary/40 hover:shadow-md sm:p-5"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Zap className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-bold text-foreground">
              See the flagship model store
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Live selling, flash deals, reviews &amp; instant chat — preview what Pro &amp; Advance
              unlock.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
        </Link>

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`relative overflow-hidden border-border/60 transition ${
                plan.highlighted
                  ? "border-primary/40 shadow-2xl shadow-primary/15 ring-1 ring-primary/25 lg:-mt-4 lg:mb-[-1rem] lg:scale-[1.03]"
                  : "hover:-translate-y-1 hover:shadow-lg"
              }`}
            >
              {plan.highlighted && (
                <>
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-amber-500" />
                  <Badge className="absolute right-4 top-4 gap-1">
                    <Sparkles className="h-3 w-3" />
                    Most popular
                  </Badge>
                </>
              )}
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.desc}</CardDescription>
                <div className="pt-2">
                  <span
                    className={`font-display text-4xl font-bold ${
                      plan.highlighted ? "text-gradient" : ""
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          plan.highlighted ? "bg-primary/10" : "bg-muted"
                        }`}
                      >
                        <Check className="h-3 w-3 text-primary" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={plan.href} className="mt-6 block">
                  <Button
                    variant={plan.highlighted ? "default" : "secondary"}
                    className="w-full"
                  >
                    {plan.cta}
                    {plan.highlighted && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-10 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Cancel anytime · Payments via BSP-regulated partners · Your customers stay yours
        </p>
      </div>
    </section>
  );
}

export function LandingCta() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-800 px-6 py-16 text-center shadow-2xl shadow-emerald-900/30 sm:px-12 sm:py-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_90%,rgba(251,191,36,0.15),transparent_45%)]" />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />

          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              Free plan · No credit card
            </span>
            <h2 className="mx-auto mt-6 max-w-2xl font-display text-3xl font-bold text-white sm:text-5xl sm:leading-[1.1]">
              Your next customer is already scrolling.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-emerald-50/90">
              Give them somewhere to tap. Launch your branded store in 5 minutes and turn your
              social following into a real business.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/model">
                <Button size="xl" variant="white">
                  Launch demo shop
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href={`${adminUrl}/signup`}>
                <Button
                  size="xl"
                  variant="outline"
                  className="border-white/30 bg-white/10 text-white hover:border-white/50 hover:bg-white/20 hover:text-white"
                >
                  Start free
                </Button>
              </Link>
              <Link href="/model?ref=cta">
                <Button
                  size="xl"
                  variant="outline"
                  className="border-white/30 bg-white/10 text-white hover:border-white/50 hover:bg-white/20 hover:text-white"
                >
                  See model store
                </Button>
              </Link>
            </div>
            <p className="mt-7 text-xs text-emerald-100/70">
              Setup in 5 minutes · GCash &amp; Maya ready · Cancel anytime
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
