"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Gem,
  LogOut,
  Monitor,
  Rocket,
  Search,
  Settings,
  Store,
} from "lucide-react";
import { GumaMark } from "@gumakart/ui";
import { UpgradeGateModal } from "@/components/plan/upgrade-gate-modal";
import { PlanTierBadge } from "@/components/plan/plan-tier-badge";
import { useTenantPlan } from "@/components/plan/use-tenant-plan";
import { DASHBOARD_NAV, type DashboardNavItem } from "@/lib/dashboard-nav";
import { SETTINGS_SECTIONS } from "@/lib/settings-nav";
import { planAtLeast, upgradeHref, type SubscriptionPlan } from "@/lib/plan-access";
import { SuspendedShopNotice } from "@/components/suspended-shop-notice";
import { SupportAccessBanner } from "@/components/support-access-banner";
import { storefrontBaseUrl } from "@/lib/utils";

interface SessionUser {
  tenantName: string;
  tenantSlug: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  tenantStatus?: string;
  supportAccess?: boolean;
}

interface GateTarget {
  item: DashboardNavItem;
}

export function AdminShell({
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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith("/settings"));
  const [gateTarget, setGateTarget] = useState<GateTarget | null>(null);
  const { plan, planLabel, credits, tenant, loading: planLoading } = useTenantPlan();

  useEffect(() => {
    if (pathname.startsWith("/settings")) setSettingsOpen(true);
  }, [pathname]);

  useEffect(() => {
    const defaults: Record<string, boolean> = {};
    for (const group of DASHBOARD_NAV) {
      if (group.defaultOpen) defaults[group.id] = true;
      if (group.items.some((item) => pathname.startsWith(item.href) && item.href !== "/")) {
        defaults[group.id] = true;
      }
    }
    setOpenGroups((prev) => ({ ...defaults, ...prev }));
  }, [pathname]);

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/session").then((res) => res.json()),
      fetch("/api/shop")
        .then((res) => res.json())
        .catch(() => null),
    ]).then(([sessionData, shopData]) => {
      if (sessionData.ok) {
        setUser({
          ...sessionData.user,
          tenantStatus: shopData?.ok ? shopData.shop.tenant.status : tenant?.status,
          supportAccess: Boolean(sessionData.supportAccess),
        });
      }
    });
  }, [tenant?.status]);

  const filteredNav = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return DASHBOARD_NAV;
    return DASHBOARD_NAV.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [search]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function isLocked(item: DashboardNavItem): boolean {
    if (!item.minPlan || item.minPlan === "free") return false;
    return !planAtLeast(plan, item.minPlan);
  }

  function handleNavClick(event: React.MouseEvent, item: DashboardNavItem) {
    if (!isLocked(item)) return;
    event.preventDefault();
    setGateTarget({ item });
  }

  const storefrontBase = storefrontBaseUrl;
  const slug = user?.tenantSlug ?? tenant?.slug;
  const showUpgrade = plan !== "pro";
  const tenantStatus = user?.tenantStatus ?? tenant?.status;
  const isSuspended = tenantStatus === "suspended";
  const supportAccess = Boolean(user?.supportAccess);

  if (isSuspended && !supportAccess) {
    return (
      <SuspendedShopNotice
        tenantName={user?.tenantName ?? tenant?.name}
        tenantSlug={slug}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="relative min-h-screen bg-guma-navy text-slate-200">
      {supportAccess && (
        <SupportAccessBanner
          tenantName={user?.tenantName ?? tenant?.name}
          tenantSlug={slug}
        />
      )}
      <div className="relative flex min-h-screen lg:flex">
      {/* Soft ambient — keep noise low so content stays readable */}
      <div className="pointer-events-none fixed inset-0 grid-bg grid-bg-fade opacity-25" />
      <div className="pointer-events-none fixed -top-48 left-0 h-[360px] w-[360px] rounded-full bg-guma-purple/[0.06] blur-[100px]" />

      <UpgradeGateModal
        open={gateTarget !== null}
        onClose={() => setGateTarget(null)}
        requiredPlan={
          (gateTarget?.item.minPlan === "pro" ? "pro" : "growth") as Exclude<
            SubscriptionPlan,
            "free"
          >
        }
        featureTitle={gateTarget?.item.label ?? "this feature"}
        featureDescription={gateTarget?.item.description}
        refSource={gateTarget ? `nav-${gateTarget.item.id}` : undefined}
      />

      {/* Sidebar — Guma One */}
      <aside className="relative z-10 flex w-full flex-col border-b border-white/[0.08] glass-strong lg:sticky lg:top-0 lg:h-screen lg:w-[260px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
          <GumaMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">
              {user?.tenantName ?? tenant?.name ?? "Your shop"}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {user?.displayName ?? "Seller workspace"}
            </p>
          </div>
        </Link>

        <div className="px-5 pb-1 mono-label">Seller Console</div>

        <div className="px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-guma-navy/60 py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-guma-purple/50 focus:outline-none"
            />
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
          {filteredNav.map((group) => {
            if (group.id === "settings") return null;
            const isCollapsible = group.collapsible && group.label;
            const expanded = openGroups[group.id] ?? !isCollapsible;

            return (
              <div key={group.id} className="pb-1">
                {group.label ? (
                  isCollapsible ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((g) => ({ ...g, [group.id]: !expanded }))
                      }
                      className="mono-label flex w-full items-center justify-between px-2 py-1.5 hover:text-slate-300"
                    >
                      {group.label}
                      <ChevronDown
                        className={`h-3 w-3 transition ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  ) : (
                    <p className="mono-label px-2 py-1.5">{group.label}</p>
                  )
                ) : null}

                {(expanded || !isCollapsible) &&
                  group.items.map((item) => {
                    const active = isActive(item.href);
                    const locked = isLocked(item);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={(e) => handleNavClick(e, item)}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                          active
                            ? "bg-white/[0.07] text-white"
                            : locked
                              ? "text-slate-500 hover:bg-white/[0.03]"
                              : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                        }`}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-guma-purple/80" />
                        ) : null}
                        <Icon
                          className={`h-4 w-4 shrink-0 ${active ? "text-slate-200" : "text-slate-500 group-hover:text-slate-400"}`}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge === "new" ? (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-guma-purple/70"
                            title="New"
                            aria-label="New"
                          />
                        ) : null}
                        {locked && item.minPlan ? (
                          <PlanTierBadge tier={item.minPlan} />
                        ) : null}
                      </Link>
                    );
                  })}
              </div>
            );
          })}

          {/* Full settings tree */}
          <div className="mt-2 border-t border-white/[0.08] pt-2">
            <button
              type="button"
              onClick={() => {
                setSettingsOpen((o) => !o);
                if (!settingsOpen && !pathname.startsWith("/settings")) {
                  router.push("/settings/shop");
                }
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                pathname.startsWith("/settings")
                  ? "bg-white/[0.07] text-white"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="h-4 w-4 text-slate-500" />
                Settings
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-500 transition ${settingsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {settingsOpen ? (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                {SETTINGS_SECTIONS.map((section) => (
                  <Link
                    key={section.href}
                    href={section.href}
                    className={`block rounded-md px-2.5 py-1.5 text-xs transition ${
                      pathname === section.href
                        ? "font-medium text-slate-100"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {section.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        {/* AI credits strip */}
        {!planLoading && credits ? (
          <div className="mx-3 mb-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
            <p className="text-xs font-medium text-slate-200">
              {credits.generationsLeft} AI generations left this month
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {planLabel} plan · {credits.chatLeft} chats today
            </p>
            {showUpgrade ? (
              <Link
                href={upgradeHref(plan === "free" ? "growth" : "pro", "sidebar-credits")}
                className="mt-2 inline-flex text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
              >
                View plans
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="hidden border-t border-white/[0.08] p-3 lg:block">
          {user ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.06] text-[10px] font-semibold text-slate-200">
                {user.displayName
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="min-w-0 text-xs">
                <p className="truncate font-semibold text-white">{user.displayName}</p>
                <p className="truncate text-slate-400">{user.email}</p>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-guma-navy/90 px-4 py-2.5 backdrop-blur-md lg:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-medium">
            {slug ? (
              <a
                href="/api/storefront-preview"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"
              >
                <Monitor className="h-3.5 w-3.5" />
                Preview
              </a>
            ) : null}
            <span className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-3 py-1.5 font-medium text-slate-100">
              <Store className="h-3.5 w-3.5 text-slate-400" />
              Dashboard
            </span>
          </div>

          <div className="flex items-center gap-2">
            {showUpgrade ? (
              <Link
                href={upgradeHref(plan === "free" ? "growth" : "pro", "topbar")}
                className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white sm:inline-flex"
              >
                <Gem className="h-3.5 w-3.5 text-slate-400" />
                Upgrade
              </Link>
            ) : null}
            {slug ? (
              <a
                href={`${storefrontBase}/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-white/[0.1]"
              >
                <Rocket className="h-3.5 w-3.5 text-slate-400" />
                <span className="hidden sm:inline">View shop</span>
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-white/5 lg:hidden"
            >
              Sign out
            </button>
          </div>
        </header>

        {user && !user.emailVerified && pathname !== "/onboarding" ? (
          <div className="border-b border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 lg:px-6">
            Verify your email to unlock all features.{" "}
            <Link href="/onboarding" className="font-medium text-slate-100 underline underline-offset-2">
              Complete setup
            </Link>
          </div>
        ) : null}

        <main className="guma-console-main flex-1 px-4 py-6 lg:px-8">
          <div className="mb-6">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>
            ) : null}
          </div>
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}
