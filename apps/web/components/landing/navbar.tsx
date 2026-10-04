"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { GumaLogo } from "@gumakart/ui";
import { Button } from "@/components/ui/button";
import { adminUrl } from "@/lib/utils";

function useMarketingHome() {
  const pathname = usePathname() ?? "/";
  const onFrontend1Preview = pathname === "/frontend1" || pathname.startsWith("/frontend1/");
  const home = onFrontend1Preview ? "/frontend1" : "/";
  return {
    home,
    featuresHref: onFrontend1Preview ? "/frontend1#features" : "/#features",
    howHref: onFrontend1Preview ? "/frontend1#how-it-works" : "/#how-it-works",
  };
}

const pageLinks = [
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "About", href: "/about" },
] as const;

export function LandingNav() {
  const { home, featuresHref, howHref } = useMarketingHome();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [home]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sectionLinks = [
    { label: "Features", href: featuresHref },
    { label: "How it works", href: howHref },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href={home} className="group flex items-center gap-2.5">
          <GumaLogo className="h-9 transition-transform group-hover:scale-[1.02] sm:h-10" />
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          {sectionLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-foreground">
              {link.label}
            </Link>
          ))}
          {pageLinks.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href={`${adminUrl}/login`} className="hidden sm:block">
            <Button variant="ghost" size="sm">
              Seller login
            </Button>
          </Link>
          <Link href={`${adminUrl}/signup`}>
            <Button size="sm" className="gap-1.5">
              Start free
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {open && (
        <div
          id="landing-mobile-nav"
          className="border-t border-border/50 bg-background px-4 py-4 md:hidden"
        >
          <nav className="flex flex-col gap-1 text-sm font-medium">
            {[...sectionLinks, ...pageLinks].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href={`${adminUrl}/login`}
              className="rounded-lg px-3 py-2.5 text-muted-foreground transition hover:bg-muted hover:text-foreground sm:hidden"
              onClick={() => setOpen(false)}
            >
              Seller login
            </Link>
            <Link
              href={`${adminUrl}/signup`}
              className="mt-2 rounded-lg bg-primary px-3 py-2.5 text-center font-semibold text-primary-foreground"
              onClick={() => setOpen(false)}
            >
              Start free
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
