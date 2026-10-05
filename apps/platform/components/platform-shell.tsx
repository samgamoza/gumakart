"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  BarChart3,
  CreditCard,
  Headphones,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users,
  X,
} from "lucide-react";
import { GumaLogo } from "@gumakart/ui";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/metrics", label: "Metrics", icon: BarChart3 },
    ],
  },
  {
    label: "Shops & people",
    items: [
      { href: "/tenants", label: "Tenants", icon: Store },
      { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/users", label: "Users", icon: Users },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/orders", label: "Orders", icon: ShoppingCart },
      { href: "/messaging", label: "SMS & opt-outs", icon: MessageSquare },
    ],
  },
  {
    label: "Trust & safety",
    items: [
      { href: "/helpdesk", label: "Helpdesk", icon: Headphones },
      { href: "/moderation", label: "Moderation", icon: ShieldCheck },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/templates", label: "Template Intel", icon: Palette },
      { href: "/frontends", label: "Frontends", icon: LayoutTemplate },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/audit", label: "Audit Log", icon: ScrollText },
    ],
  },
];

interface ShellUser {
  displayName: string;
  email: string;
}

export function PlatformShell({
  title,
  subtitle,
  user,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  user: ShellUser;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const initials = user.displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col text-emerald-50">
      <div className="px-5 py-5">
        <div className="min-w-0">
          <GumaLogo on="dark" className="h-11 max-w-full" />
          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-300/80">
            <ShieldCheck className="h-3 w-3" />
            Platform Console
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-emerald-300/45">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? "bg-white/15 text-white shadow-sm"
                        : "text-emerald-100/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-emerald-200" : "text-emerald-300/60"
                      }`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-xs font-bold text-emerald-100">
            {initials}
          </span>
          <div className="min-w-0 text-xs">
            <p className="truncate font-semibold text-white">{user.displayName}</p>
            <p className="truncate text-emerald-200/60">{user.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-white/10"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sidebar-glow sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="sidebar-glow absolute left-0 top-0 h-full w-64">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-emerald-100 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        </header>
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
