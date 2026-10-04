import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GumaMark, GumaWordmark } from "@gumakart/ui";
import "./kart.css";

/*
  Guma Kart revamp (2026-09) — lives entirely under /kart so the existing
  storefront, checkout and admin stay untouched. See docs/KART-REVAMP.md.
*/
export const metadata: Metadata = {
  title: "Guma Kart — Social checkout",
  description: "Comment MINE, get a checkout link, pay with GCash / Maya / COD, delivered by BayanGo.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#ff6b00",
};

export default function KartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kart min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-[color:var(--kart-line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/kart" className="flex items-center gap-2 font-extrabold tracking-tight">
            <GumaMark className="h-8 w-8" />
            <GumaWordmark className="h-4" />
          </Link>
          <nav className="hidden gap-1 text-sm font-semibold sm:flex">
            {[
              ["Setup", "/kart/setup"],
              ["DM", "/kart/dm"],
              ["Checkout", "/kart/checkout"],
              ["Track", "/kart/track"],
            ].map(([l, h]) => (
              <Link key={h} href={h} className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                {l}
              </Link>
            ))}
          </nav>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">Preview</span>
        </div>
      </header>
      {children}
    </div>
  );
}
