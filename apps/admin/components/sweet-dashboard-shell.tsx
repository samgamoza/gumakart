"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bot,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { resolveStorePattern } from "@gumakart/storefront-themes";
import type { StorePatternId } from "@gumakart/storefront-themes";
import { SuspendedShopNotice } from "@/components/suspended-shop-notice";
import { SupportAccessBanner } from "@/components/support-access-banner";

const SWEET_TABS = [
  { id: "overview", label: "Overview", href: "/", icon: LayoutDashboard },
  { id: "checkout-links", label: "Checkout links", href: "/checkout-links", icon: Link2 },
  { id: "products", label: "Products", href: "/products", icon: Package },
  { id: "orders", label: "Orders", href: "/orders", icon: ShoppingBag },
  { id: "customers", label: "Customers", href: "/customers", icon: Users },
  { id: "ai", label: "Workspace", href: "/workspace", icon: Sparkles },
  { id: "agents", label: "Automations", href: "/workspace/automations", icon: Bot },
  { id: "settings", label: "Settings", href: "/settings/shop", icon: Settings },
] as const;

export function SweetDashboardShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{
    tenantName: string;
    tenantSlug: string;
    displayName: string;
    tenantStatus?: string;
    supportAccess?: boolean;
  } | null>(null);
  const [accent, setAccent] = useState("#FF007F");

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/session").then((res) => res.json()),
      fetch("/api/shop").then((res) => res.json()),
    ]).then(([sessionData, shopData]) => {
      if (sessionData.ok) {
        setUser({
          ...sessionData.user,
          tenantStatus: shopData?.ok ? shopData.shop.tenant.status : undefined,
          supportAccess: Boolean(sessionData.supportAccess),
        });
      }
      if (shopData?.ok && shopData.theme?.primaryColor) {
        setAccent(shopData.theme.primaryColor);
      }
    });
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const storefrontBase = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";
  const slug = user?.tenantSlug;

  const supportAccess = Boolean(user?.supportAccess);

  if (user?.tenantStatus === "suspended" && !supportAccess) {
    return (
      <SuspendedShopNotice
        tenantName={user.tenantName}
        tenantSlug={slug}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1012] text-white">
      {supportAccess && (
        <SupportAccessBanner tenantName={user?.tenantName} tenantSlug={slug} />
      )}
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-xs uppercase tracking-[0.2em] text-white/30">
              Simply Sweet pattern
            </p>
            <h1 className="font-serif text-3xl font-bold">{title}</h1>
            {description && <p className="mt-1 text-sm text-white/40">{description}</p>}
            {!description && user?.tenantName && (
              <p className="mt-1 text-sm text-white/40">
                Manage {user.tenantName} — baking business dashboard
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {slug && (
              <a
                href={`${storefrontBase}/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/20"
              >
                <Store className="h-4 w-4" /> View site <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-white/50 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>

        <div className="mb-8 flex gap-1 overflow-x-auto border-b border-white/10">
          {SWEET_TABS.map((tab) => {
            const active = isActive(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className="-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium transition"
                style={
                  active
                    ? { color: accent, borderColor: accent }
                    : { color: "rgba(255,255,255,0.4)", borderColor: "transparent" }
                }
              >
                <Icon className="h-4 w-4" /> {tab.label}
              </Link>
            );
          })}
        </div>

        <div className="sweet-dashboard-content">{children}</div>
      </div>
    </div>
  );
}

export function useTenantPattern(): {
  patternId: StorePatternId;
  loading: boolean;
} {
  const [patternId, setPatternId] = useState<StorePatternId>("classic");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shop")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok) {
          const themeJson = data.storefront?.themeJson ?? {};
          setPatternId(resolveStorePattern(themeJson));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return { patternId, loading };
}
