import Link from "next/link";
import { ArrowRight, MessageSquareText, Settings2, ShoppingBag, Truck } from "lucide-react";

type Status = "today" | "partly" | "soon";

const STATUS_LABEL: Record<Status, string> = { today: "Works today", partly: "Partly live", soon: "Coming soon" };
const STATUS_STYLE: Record<Status, string> = {
  today: "bg-emerald-50 text-emerald-700",
  partly: "bg-[color:var(--kart-orange-soft)] text-[color:var(--kart-orange-dark)]",
  soon: "bg-slate-100 text-slate-700",
};

const STEPS: Array<{ n: number; title: string; body: string; status: Status }> = [
  { n: 1, title: "Buyer comments “MINE”", body: "On a Facebook post, live, Instagram or TikTok.", status: "today" },
  { n: 2, title: "The link reaches their DM", body: "You send your checkout link today. The automatic DM comes after Meta approval.", status: "soon" },
  { n: 3, title: "One-page mobile checkout", body: "Name, mobile, barangay-level address, GCash / Maya / COD.", status: "today" },
  { n: 4, title: "You confirm payment", body: "Check the buyer’s proof and confirm in one tap. Automatic confirmation comes with online payments.", status: "today" },
  { n: 5, title: "Send a rider", body: "Assign your own rider now. Courier booking, BayanGo and SMS updates are on the way.", status: "partly" },
];

const SCREENS = [
  { href: "/kart/setup", icon: Settings2, title: "Merchant setup", body: "Keyword trigger card + Auto-DM listener switch." },
  { href: "/kart/dm", icon: MessageSquareText, title: "Social DM", body: "What the buyer sees in Messenger / IG / TikTok." },
  { href: "/kart/checkout", icon: ShoppingBag, title: "One-page checkout", body: "PSGC address dropdowns, e-wallet cards, sticky CTA." },
  { href: "/kart/track", icon: Truck, title: "Fulfilment tracker", body: "Delivery timeline + chat-with-seller." },
];

export default function KartHub() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--kart-orange)" }}>
        Social automated checkout · Philippines first
      </p>
      <h1 className="mt-2 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
        Turn every “MINE” comment into a paid, delivered order.
      </h1>
      <p className="mt-3 max-w-2xl text-[color:var(--kart-muted)]">
        Share one checkout link. Buyers pay with GCash, Maya or cash on delivery, and you confirm in one tap. This page previews
        the full flow with demo data, and each step says what works today. Every screen below is real, responsive code under{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">apps/web/app/kart</code>; the old storefront and checkout are untouched.
      </p>

      <ol className="mt-10 grid gap-3 sm:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="k-card p-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ background: "var(--kart-ink)" }}>
              {s.n}
            </span>
            <p className="mt-3 text-sm font-bold leading-snug">{s.title}</p>
            <p className="mt-1 text-xs text-[color:var(--kart-muted)]">{s.body}</p>
            <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 text-lg font-extrabold tracking-tight">Screens</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {SCREENS.map((s) => (
          <Link key={s.href} href={s.href} className="k-card group flex items-start gap-4 p-5 transition-colors hover:border-slate-400">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--kart-orange-soft)", color: "var(--kart-orange-dark)" }}>
              <s.icon className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-base font-extrabold">{s.title}</span>
              <span className="block text-sm text-[color:var(--kart-muted)]">{s.body}</span>
            </span>
            <ArrowRight className="mt-1 h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>

      <div className="mt-12 grid gap-3 rounded-2xl border border-[color:var(--kart-line)] bg-white p-5 text-sm sm:grid-cols-3">
        <div>
          <p className="font-bold">Data-light by design</p>
          <p className="text-[color:var(--kart-muted)]">No product photos fetched, no video, no parallax. The checkout is a few KB over a free-data promo.</p>
        </div>
        <div>
          <p className="font-bold">Mobile number, not email</p>
          <p className="text-[color:var(--kart-muted)]">The buyer’s PH mobile is the account key; updates go out by SMS.</p>
        </div>
        <div>
          <p className="font-bold">Fees before the button</p>
          <p className="text-[color:var(--kart-muted)]">Product, delivery fee and COD fee are itemised above the CTA, never after.</p>
        </div>
      </div>
    </main>
  );
}
