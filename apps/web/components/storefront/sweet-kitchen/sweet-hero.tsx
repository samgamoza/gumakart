"use client";

import { sizedImageUrl, sizedSrcSet } from "@/lib/image-sizes";
import Link from "next/link";
import { Play, ShoppingBag, Sparkles } from "lucide-react";
import type { DemoTenant } from "@/lib/demo-data";

const DEFAULT_HERO =
  "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=1600&q=80";

export function SweetHero({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;
  const accent = theme.primaryColor;
  const heroImage = tenant.coverUrl ?? DEFAULT_HERO;

  return (
    <section className="relative flex min-h-[85vh] items-center overflow-hidden pt-24">
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sizedImageUrl(heroImage, 640)} srcSet={sizedSrcSet(heroImage, 640)} sizes="100vw" alt="" fetchPriority="high" decoding="async" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#fffdf5]/95 via-[#fffdf5]/75 to-transparent" />
      </div>
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-xl">
          <span
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wider"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            <Sparkles className="h-3.5 w-3.5" /> Welcome to my kitchen · QC
          </span>
          <h1 className="font-display mt-6 text-6xl leading-[0.95] text-[#2d1b1b] md:text-8xl">
            {tenant.name.split(" ").slice(0, -1).join(" ") || tenant.name}
          </h1>
          <h2 className="font-heading mt-1 text-2xl font-semibold text-[#2d1b1b] md:text-3xl">
            {tenant.name.split(" ").slice(-1)[0] ?? "Creations"}
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-[#2d1b1b]/60">
            {tenant.tagline}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href={`/${tenant.slug}#featured`}
              className="neon-btn inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium uppercase tracking-wide"
              style={{ backgroundColor: accent }}
            >
              <Play className="h-4 w-4" /> Shop treats
            </Link>
            <Link
              href={`/${tenant.slug}#shop`}
              className="inline-flex items-center gap-2 rounded-full border-2 px-6 py-3 text-sm font-medium uppercase tracking-wide transition hover:bg-[#ffd1dc]/30"
              style={{ borderColor: accent, color: accent }}
            >
              <ShoppingBag className="h-4 w-4" /> Browse all
            </Link>
          </div>
          <p className="mt-6 text-sm text-[#2d1b1b]/50">
            {theme.promoTitle}
            {theme.promoSubtitle ? ` · ${theme.promoSubtitle}` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
