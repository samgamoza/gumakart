import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  CreditCard,
  Gift,
  Globe,
  Layers,
  MessageSquare,
  Printer,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  Users,
  WifiOff,
  Zap,
} from "lucide-react";
import { SELLER_PLANS } from "@gumakart/plans";
import { CheckoutDemo } from "@/components/marketing/palenke/CheckoutDemo";
import { adminUrl } from "@/lib/utils";

/**
 * frontend3 — the Palenke AI landing (look adapted from the palenkeAi prototype).
 * Copy rule: only what Guma Kart actually does today. No invented sales figures, user counts or
 * testimonials (see the "no invented numbers" decision in the progress doc).
 */

const NAV = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Install", href: "#install" },
  { label: "Pricing", href: "#pricing" },
];

const ECOSYSTEM = [
  {
    icon: CreditCard,
    tone: "bg-purple-50 text-purple-600",
    title: "PH e-wallet checkout links",
    body: "One link per post or chat. Buyers pay with GCash, Maya or COD and attach their receipt — you confirm in one tap. PayMongo cards and e-wallets plug in when your account is approved.",
    chips: ["GCash", "Maya", "COD", "PayMongo-ready"],
  },
  {
    icon: Truck,
    tone: "bg-amber-50 text-amber-600",
    title: "Delivery quotes & rider booking",
    body: "Buyers see the delivery fee at checkout. You book the rider from the order, or set a free-delivery minimum that always wins.",
    chips: ["Grab", "BayanGo", "Pickup"],
  },
  {
    icon: Printer,
    tone: "bg-rose-50 text-rose-600",
    title: "Cloud POS for your physical store",
    body: "Shifts, split tender, Senior/PWD discount, 58/80 mm receipts, returns — and it keeps selling offline, syncing when the signal is back. BIR numbering is ready once your accountant signs off.",
    chips: ["Offline mode", "X/Z readings", "Barcode scan"],
  },
  {
    icon: Sparkles,
    tone: "bg-indigo-50 text-indigo-600",
    title: "AI that works like a Pinoy seller",
    body: "Taglish captions with your checkout link, suggested chat replies from your real prices and stock, and “Ask Guma” — an advisor that reads your own sales. Monthly limits per plan.",
    chips: ["Captions", "Reply suggestions", "Ask Guma"],
  },
];

const MORE = [
  { icon: Boxes, title: "Variants & branch stock", body: "Size × color, per-variant price and stock, multiple branches." },
  { icon: MessageSquare, title: "Messenger & IG inbox", body: "Reply and send checkout links from one inbox (after Meta approval)." },
  { icon: Layers, title: "Shopee & Lazada sync", body: "One stock count across your marketplaces (with partner keys)." },
  { icon: Users, title: "Staff with roles", body: "Manager, staff and cashier logins. No more shared owner password." },
  { icon: Gift, title: "Suki loyalty tiers", body: "Points on every paid order, Bronze to Platinum, paid out as store credit." },
  { icon: BadgeCheck, title: "Guma ID", body: "Repeat buyers check out in one tap across every Guma shop." },
  { icon: ShieldCheck, title: "Two-step sign-in", body: "Protect your shop with an authenticator app." },
  { icon: Zap, title: "Reports, deals & SMS", body: "Sales by product and channel, bundles, gift cards, consent-based SMS campaigns." },
];

const HOW = [
  { n: 1, title: "Create your shop", body: "Pick a template, add products from your phone. Photos are resized for you." },
  { n: 2, title: "Share one link", body: "Post it on Facebook, Instagram or TikTok, or paste it in chat." },
  { n: 3, title: "Get paid & ship", body: "Confirm payment, book the rider, and the buyer gets updates." },
];

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-purple-400/20 bg-purple-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-purple-300">
      {children}
    </span>
  );
}

export function Frontend3Landing() {
  const plans = SELLER_PLANS;
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900" data-landing="palenke">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-lg font-black text-white shadow-md shadow-purple-500/30">
              P
            </span>
            <span className="text-lg font-black tracking-tight">
              Palenke <span className="bg-gradient-to-r from-purple-600 to-indigo-500 bg-clip-text text-transparent">AI</span>
            </span>
            <span className="hidden rounded-md bg-purple-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-purple-700 sm:inline">
              by Guma Kart
            </span>
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href={`${adminUrl}/login`} className="hidden px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 sm:block">
              Log in
            </a>
            <a href={`${adminUrl}/signup`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-white shadow hover:bg-slate-800">
              Start free
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-20 px-4 pb-20 pt-8 sm:px-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[32px] border border-purple-500/10 bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 px-6 py-14 text-white shadow-2xl sm:rounded-[40px] sm:px-10 md:py-20">
          <div className="pointer-events-none absolute -right-16 -top-16 h-96 w-96 animate-pulse rounded-full bg-purple-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="relative z-10 grid items-center gap-12 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-7">
              <Badge>
                <Sparkles className="h-3.5 w-3.5 text-purple-400" /> No more “PM is key”
              </Badge>
              <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
                Stop chatting.
                <br />
                <span className="bg-gradient-to-r from-purple-400 via-pink-300 to-indigo-300 bg-clip-text text-transparent">Start selling.</span>
              </h1>
              <p className="max-w-xl text-sm font-medium leading-relaxed text-slate-300 md:text-base">
                Palenke AI turns your Facebook, Instagram and TikTok posts into a real shop: one checkout link, GCash and Maya payments, delivery
                booking, and a cloud POS for your counter — built for Filipino sellers.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href={`${adminUrl}/signup`}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3.5 text-xs font-extrabold uppercase tracking-widest text-white shadow-lg shadow-purple-500/20 transition hover:-translate-y-0.5 hover:shadow-purple-500/40"
                >
                  Create my shop free <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#install"
                  className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-950/60 px-5 py-3.5 text-xs font-extrabold uppercase tracking-widest text-purple-200 transition hover:bg-purple-900/80"
                >
                  <Smartphone className="h-4 w-4 text-purple-400" /> Install as an app
                </a>
              </div>
              <dl className="grid grid-cols-3 gap-4 border-t border-slate-800/60 pt-6">
                {[
                  ["₱0", "To start"],
                  ["No app", "Needed by buyers"],
                  ["1 link", "Per post or chat"],
                ].map(([v, l]) => (
                  <div key={l}>
                    <dt className="text-xl font-black text-purple-300 md:text-2xl">{v}</dt>
                    <dd className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="lg:col-span-5">
              <CheckoutDemo />
            </div>
          </div>
        </section>

        {/* Ecosystem */}
        <section id="features" className="scroll-mt-24 space-y-10">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-600">One shop, every channel</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">The ecosystem built for micro-sellers</h2>
            <p className="mt-3 text-sm text-slate-500">Online orders, the counter and your marketplaces share one stock count and one order list.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {ECOSYSTEM.map((f) => {
              const Icon = f.icon;
              return (
                <article key={f.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${f.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-black uppercase tracking-wide">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {f.chips.map((c) => (
                      <span key={c} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                        {c}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MORE.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <Icon className="h-5 w-5 text-purple-600" />
                  <h4 className="mt-3 text-sm font-bold">{m.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-600">How it works</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">From comment to delivered in three steps</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-3">
              {HOW.map((h) => (
                <li key={h.n} className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-sm font-black text-white">{h.n}</span>
                  <h3 className="mt-3 font-bold">{h.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{h.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Install as app */}
        <section id="install" className="scroll-mt-24 overflow-hidden rounded-[32px] bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950 px-6 py-12 text-white sm:rounded-[40px] sm:px-10">
          <Badge>
            <Smartphone className="h-3.5 w-3.5" /> Works like an app
          </Badge>
          <h2 className="mt-4 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
            Add it to your <span className="bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">home screen</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">
            No Play Store or App Store download. Your shop and your seller dashboard open full-screen from the home screen, and the POS keeps
            ringing up sales when the signal drops.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { icon: Globe, t: "Android (Chrome)", d: "Open your shop or dashboard → ⋮ menu → “Add to Home screen”." },
              { icon: Smartphone, t: "iPhone (Safari)", d: "Tap Share → “Add to Home Screen”." },
              { icon: WifiOff, t: "Offline POS", d: "Sales queue on the device and sync once you're back online." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <Icon className="h-5 w-5 text-purple-300" />
                <h3 className="mt-3 text-sm font-bold">{t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-24 space-y-8">
          <div className="text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-600">Simple pricing</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Start free. Upgrade when you grow.</h2>
          </div>
          <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
            {plans.map((p) => {
              const featured = p.id === "growth";
              return (
                <div
                  key={p.id}
                  className={`relative flex flex-col rounded-3xl border p-6 ${
                    featured ? "border-purple-900 bg-gradient-to-b from-slate-950 to-purple-950 text-white shadow-2xl md:-translate-y-2" : "border-slate-200 bg-white"
                  }`}
                >
                  {featured && (
                    <span className="absolute -top-3 right-5 rounded-full bg-amber-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-900">Most popular</span>
                  )}
                  <span className={`w-fit rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${featured ? "bg-purple-500/20 text-purple-200" : "bg-slate-100 text-slate-600"}`}>
                    {p.name}
                  </span>
                  <p className={`mt-3 text-sm ${featured ? "text-slate-300" : "text-slate-500"}`}>{p.tagline}</p>
                  <p className="mt-4 text-4xl font-black">
                    ₱{p.priceMonthly.toLocaleString("en-PH")}
                    <span className={`ml-1 text-sm font-semibold ${featured ? "text-slate-400" : "text-slate-400"}`}>/ mo</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {p.marketingFeatures.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-amber-300" : "text-emerald-500"}`} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`${adminUrl}/signup`}
                    className={`mt-6 rounded-xl px-4 py-3 text-center text-xs font-extrabold uppercase tracking-widest ${
                      featured ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white" : "border border-slate-200 text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    {p.priceMonthly === 0 ? "Start free" : `Start with ${p.name}`}
                  </a>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-slate-400">
            Fees for online payments through the Guma wallet are on the{" "}
            <Link href="/pricing" className="underline hover:text-slate-600">pricing page</Link>.
          </p>
        </section>

        {/* Closing */}
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
          <Store className="mx-auto h-8 w-8 text-purple-600" />
          <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">Your next order is one link away</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">Set up takes a few minutes. Free plan, no card needed.</p>
          <a
            href={`${adminUrl}/signup`}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3.5 text-xs font-extrabold uppercase tracking-widest text-white shadow-lg shadow-purple-500/20"
          >
            Create my shop <ArrowRight className="h-4 w-4" />
          </a>
        </section>
      </main>

      <footer className="bg-slate-950 px-4 py-10 text-center text-xs text-slate-400">
        <p className="font-semibold text-slate-200">Palenke AI — social selling, built for Filipino micro & small sellers.</p>
        <p className="mt-2">
          A Guma Kart experience ·{" "}
          <Link href="/terms" className="underline hover:text-white">Terms</Link> ·{" "}
          <Link href="/privacy" className="underline hover:text-white">Privacy</Link> ·{" "}
          <Link href="/status" className="underline hover:text-white">Status</Link>
        </p>
      </footer>
    </div>
  );
}
