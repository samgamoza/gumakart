"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Mail, MapPin } from "lucide-react";
import { GumaLogo } from "@gumakart/ui";
import { Button } from "@/components/ui/button";
import { company, footerLinks } from "@/lib/site-content";
import { adminUrl } from "@/lib/utils";

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <nav aria-label={title}>
      <h3 className="font-display text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={`${link.label}-${link.href}`}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function LandingFooter() {
  const pathname = usePathname() ?? "/";
  const onFrontend1Preview = pathname === "/frontend1" || pathname.startsWith("/frontend1/");
  const home = onFrontend1Preview ? "/frontend1" : "/";
  const featuresHref = onFrontend1Preview ? "/frontend1#features" : "/#features";
  const howHref = onFrontend1Preview ? "/frontend1#how-it-works" : "/#how-it-works";

  const productLinks = footerLinks.product.map((link) => {
    if (link.label === "Features") return { ...link, href: featuresHref };
    if (link.label === "How it works") return { ...link, href: howHref };
    return link;
  });

  return (
    <footer className="relative overflow-hidden border-t border-border/50">
      {/* Atmosphere — matches landing emerald/amber language without a flat slab */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-muted/40 via-background to-emerald-50/50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-10 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6 sm:pt-16">
        {/* Brand + CTA band */}
        <div className="flex flex-col gap-8 border-b border-border/50 pb-12 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-md">
            <Link href={home} className="group inline-flex items-center gap-2.5">
              <GumaLogo className="h-14 transition-transform group-hover:scale-[1.02]" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Branded storefronts for Philippine social sellers — guest checkout, seller inbox,
              and Book / Assign courier when you&apos;re ready to ship.
            </p>
            <div className="mt-5 flex flex-col gap-2.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
              <a
                href={`mailto:${company.email}`}
                className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
              >
                <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {company.email}
              </a>
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {company.address}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link href={`${adminUrl}/signup`} className="sm:min-w-[10.5rem]">
              <Button className="w-full gap-1.5">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/contact" className="sm:min-w-[10.5rem]">
              <Button variant="secondary" className="w-full">
                Contact support
              </Button>
            </Link>
          </div>
        </div>

        {/* Link columns */}
        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-3">
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="For sellers" links={footerLinks.sellers} />
          <FooterColumn title="Company" links={footerLinks.company} />
        </div>

        {/* Legal / meta */}
        <div className="flex flex-col gap-5 border-t border-border/50 pt-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2 text-center lg:text-left">
              <p className="text-xs text-muted-foreground">
                © {new Date().getFullYear()} {company.name}. All rights reserved.
              </p>
              <p className="inline-flex max-w-xl items-start justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/80 px-3 py-1 text-[11px] leading-snug text-amber-900/90 lg:justify-start">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                {company.registry}
              </p>
            </div>

            <nav
              aria-label="Legal"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground lg:justify-end"
            >
              {footerLinks.legal.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <p className="max-w-3xl text-center text-[11px] leading-relaxed text-muted-foreground/85 lg:text-left">
            Built for RA 10173 (Data Privacy Act) and RA 11967 (Internet Transactions Act). Soft-launch
            payments are typically direct GCash / Maya / COD; PayMongo is used only when enabled with
            live credentials.
          </p>
        </div>
      </div>
    </footer>
  );
}
