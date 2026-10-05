"use client";

import Image from "next/image";
import Link from "next/link";
import { Play, ShoppingBag, Sparkles } from "lucide-react";
import type { DemoTenant } from "@/lib/demo-data";

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount).replace(/\.00$/, "");
}

export function StorefrontHero({ tenant }: { tenant: DemoTenant }) {
  const theme = tenant.shopTheme;
  const spotlight = tenant.products[0];
  if (!spotlight) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6 md:px-8">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div
          className="relative overflow-hidden p-7 sm:p-10"
          style={{
            borderRadius: theme.radius,
            backgroundColor: theme.foreground,
            color: theme.background,
          }}
        >
          <div className="relative z-10 max-w-md">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur"
              style={{ backgroundColor: `${theme.background}26` }}
            >
              <Sparkles className="size-3.5" /> AI-powered social store
            </span>
            <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-5xl">
              {tenant.tagline}
            </h1>
            <p className="mt-3 text-sm leading-relaxed opacity-70 text-pretty sm:text-base">
              {theme.promoSubtitle || `Welcome to ${tenant.name}`}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="#live"
                className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform active:scale-95"
                style={{
                  backgroundColor: theme.primaryColor,
                  color: theme.mode === "dark" ? theme.foreground : "#fff",
                }}
              >
                <Play className="size-4 fill-current" /> Watch live
              </a>
              <a
                href="#featured"
                className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold backdrop-blur transition-colors"
                style={{ backgroundColor: `${theme.background}26` }}
              >
                <ShoppingBag className="size-4" /> Shop now
              </a>
            </div>
          </div>
          <Sparkles className="absolute -right-6 -top-6 size-40 opacity-5" />
        </div>

        <Link
          href={`/${tenant.slug}/products/${spotlight.slug}`}
          className="group relative overflow-hidden transition hover:scale-[1.01]"
          style={{
            borderRadius: theme.radius,
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.cardBackground,
          }}
        >
          <div className="relative aspect-[4/3] overflow-hidden">
            <Image
              src={spotlight.image}
              alt={spotlight.title}
              fill
              className="object-cover transition group-hover:scale-105"
              sizes="400px"
              priority
            />
          </div>
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.muted }}>
              Trending now
            </p>
            <h2 className="mt-1 text-lg font-bold">{spotlight.title}</h2>
            <p className="mt-1 text-xl font-bold" style={{ color: theme.primaryColor }}>
              {formatPrice(spotlight.price)}
            </p>
          </div>
        </Link>
      </div>
    </section>
  );
}
