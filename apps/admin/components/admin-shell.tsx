"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Link2,
  LayoutDashboard,
  Menu,
  Package,
  ShoppingBag,
  X,
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
import { canOpenPage, ROLE_LABELS, shopRoleOf } from "@gumakart/db/staff-permissions";
import { SETTINGS_SECTIONS } from "@/lib/settings-nav";
import { planAtLeast, upgradeHref, type SubscriptionPlan } from "@/lib/plan-access";
import { SuspendedShopNotice } from "@/components/suspended-shop-notice";
import { SupportAccessBanner } from "@/components/support-access-banner";
import { PartnerAccessBanner } from "@/components/partner-access-banner";
import { NewOrderAlerts } from "@/components/new-order-alerts";
import { PlanNoticeBanner } from "@/components/plan-notice-banner";
import { storefrontBaseUrl } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

interface SessionUser {
  role: string;
  staffRole?: string | null;
  tenantName: string;
  tenantSlug: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  tenantStatus?: string;
  supportAccess?: boolean;
  partnerAccess?: { partnerName: string; shopName: string } | null;
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
  // Phones: the sidebar is a slide-in drawer opened from the top bar.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  // Drawer: Escape closes it and the page behind doesn't scroll while it's open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);
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
      if (sessionData.partnerRevoked) {
        window.location.href = sessionData.redirectTo ?? "/partner";
        return;
      }
      if (sessionData.ok) {
        setUser({
          ...sessionData.user,
          tenantStatus: shopData?.ok ? shopData.shop.tenant.status : tenant?.status,
          supportAccess: Boolean(sessionData.supportAccess),
          partnerAccess: sessionData.partnerAccess ?? null,
        });
      }
    });
  }, [tenant?.status]);

  // Phase 10: staff only see what their role can open (the API enforces it too).
  const shopRole = user ? shopRoleOf({ role: user.role, staffRole: user.staffRole ?? null }) : "owner";
  const filteredNav = useMemo(() => {
    const q = search.trim().toLowerCase();
    const allowed = DASHBOARD_NAV.map((group) => ({
      ...group,
      items: group.items.filter((item) => canOpenPage(shopRole, item.href.split("?")[0]!)),
    })).filter((group) => group.items.length > 0);
    if (!q) return allowed;
    return allowed
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [search, shopRole]);

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
  const showUpgrade = plan !== "pro" && shopRole === "owner";
  const settingsSections = SETTINGS_SECTIONS.filter((section) => canOpenPage(shopRole, section.href));
  const roleBadge = shopRole && shopRole !== "owner" ? ROLE_LABELS[shopRole].label : null;
  const tenantStatus = user?.tenantStatus ?? tenant?.status;
  const isSuspended = tenantStatus === "suspended";
  const supportAccess = Boolean(user?.supportAccess);
  const searching = search.trim().length > 0;
  // Phones: the four daily pages sit in a bottom bar; everything else is in the menu.
  const bottomNav = [
    { href: "/", label: "Home", icon: LayoutDashboard },
    { href: "/orders", label: "Orders", icon: ShoppingBag },
    { href: "/checkout-links", label: "Links", icon: Link2 },
    { href: "/products", label: "Products", icon: Package },
  ].filter((item) => canOpenPage(shopRole, item.href));

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
    <div className="relative min-h-screen bg-background text-foreground">
      {supportAccess && (
        <SupportAccessBanner
          tenantName={user?.tenantName ?? tenant?.name}
          tenantSlug={slug}
        />
      )}
      {user?.partnerAccess && <PartnerAccessBanner partnerName={user.partnerAccess.partnerName} shopName={user.partnerAccess.shopName} />}
      <NewOrderAlerts />
      {shopRole === "owner" && !supportAccess && <PlanNoticeBanner />}
      <div className="relative min-h-screen lg:flex">
      {/* Soft ambient — keep noise low so content stays readable */}
      <div className="pointer-events-none fixed inset-0 hidden grid-bg grid-bg-fade opacity-25 dark:block" />
      <div className="pointer-events-none fixed -top-48 left-0 h-[360px] w-[360px] rounded-full bg-violet-400/[0.10] blur-[100px] dark:bg-guma-purple/[0.06]" />

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

      {menuOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      ) : null}

      {/* Sidebar — Guma One (drawer on phones, fixed column on desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 dark:border-white/[0.08] dark:bg-guma-navy dark:glass-strong lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:w-[260px] lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center">
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 px-5 py-5">
          <GumaMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
              {user?.tenantName ?? tenant?.name ?? "Your shop"}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {user?.displayName ?? "Seller workspace"}
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
          className="mr-3 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
        </div>

        <div className="px-5 pb-1 mono-label">Seller Console</div>

        <div className="px-4 py-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              aria-label="Find a page"
              placeholder="Find a page…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-guma-navy/60 dark:text-white"
            />
          </div>
        </div>

        <nav aria-label="Seller menu" className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
          {searching && filteredNav.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No page matches “{search.trim()}”.</p>
          ) : null}
          {filteredNav.map((group) => {
            if (group.id === "settings") return null;
            const isCollapsible = group.collapsible && group.label;
            // While searching, matches inside folded groups are shown too.
            const expanded = searching || (openGroups[group.id] ?? !isCollapsible);

            return (
              <div key={group.id} className="pb-1">
                {group.label ? (
                  isCollapsible ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((g) => ({ ...g, [group.id]: !expanded }))
                      }
                      aria-expanded={expanded}
                      aria-controls={`nav-group-${group.id}`}
                      className="mono-label flex min-h-[40px] w-full items-center justify-between rounded-lg px-2 py-1.5 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 dark:hover:text-slate-300"
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

                <div id={`nav-group-${group.id}`} className="space-y-0.5">
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
                        aria-current={active ? "page" : undefined}
                        title={item.description}
                        className={`group relative flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors lg:min-h-[38px] lg:text-[13px] ${
                          active
                            ? "bg-violet-600 text-white shadow-md shadow-violet-600/25 dark:bg-white/[0.07] dark:shadow-none"
                            : locked
                              ? "text-slate-400 hover:bg-slate-50 dark:text-slate-500 dark:hover:bg-white/[0.03]"
                              : "text-slate-600 hover:bg-violet-50 hover:text-violet-700 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
                        }`}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 hidden h-4 w-0.5 -translate-y-1/2 rounded-full bg-guma-purple/80 dark:block" />
                        ) : null}
                        <Icon
                          className={`h-4 w-4 shrink-0 ${active ? "text-current opacity-90" : "text-slate-400 group-hover:text-current"}`}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge === "new" ? (
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-white/80" : "bg-violet-500 dark:bg-guma-purple/70"}`}
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
              </div>
            );
          })}

          {/* Full settings tree */}
          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-white/[0.08]">
            <button
              type="button"
              onClick={() => {
                setSettingsOpen((o) => !o);
                if (!settingsOpen && !pathname.startsWith("/settings")) {
                  router.push(settingsSections[0]?.href ?? "/settings/account");
                }
              }}
              aria-expanded={settingsOpen}
              className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition-colors lg:min-h-[38px] lg:text-[13px] ${
                pathname.startsWith("/settings")
                  ? "bg-violet-50 text-violet-700 dark:bg-white/[0.07] dark:text-white"
                  : "text-slate-600 hover:bg-violet-50 hover:text-violet-700 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Settings className="h-4 w-4 text-slate-400" />
                Settings
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-500 transition ${settingsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {settingsOpen ? (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                {settingsSections.map((section) => (
                  <Link
                    key={section.href}
                    href={section.href}
                    aria-current={pathname === section.href ? "page" : undefined}
                    className={`flex min-h-[40px] items-center rounded-md px-2.5 py-1.5 text-sm transition lg:min-h-0 lg:text-xs ${
                      pathname === section.href
                        ? "font-semibold text-violet-700 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-300"
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
          <div className="mx-3 mb-3 hidden rounded-2xl border border-violet-100 lg:block bg-gradient-to-br from-violet-50 to-white p-3 dark:border-white/[0.08] dark:from-transparent dark:to-transparent dark:bg-white/[0.03]">
            <p className="pk-label mb-1 !text-violet-600 dark:!text-violet-300">AI credits</p>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
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

        <div className="hidden border-t border-slate-200 p-3 dark:border-white/[0.08] lg:block">
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
                <p className="truncate text-slate-400">
                  {roleBadge ? <span className="mr-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">{roleBadge}</span> : null}
                  {user.email}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200/80 bg-white/85 px-3 py-2.5 backdrop-blur-md dark:border-white/[0.08] dark:bg-guma-navy/90 sm:gap-4 sm:px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 dark:border-white/10 dark:text-slate-200 lg:hidden"
          >
            <Menu className="h-4 w-4" /> Menu
          </button>
          <div className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-xs font-semibold dark:border-white/[0.08] dark:bg-white/[0.02] sm:flex">
            {slug ? (
              <a
                href="/api/storefront-preview"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-500 hover:text-slate-900 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
              >
                <Monitor className="h-3.5 w-3.5" />
                Preview
              </a>
            ) : null}
            <span className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-slate-900 shadow-sm dark:bg-white/[0.06] dark:text-slate-100 dark:shadow-none">
              <Store className="h-3.5 w-3.5 text-violet-600 dark:text-slate-400" />
              Dashboard
            </span>
          </div>

          <div className="flex items-center gap-2">
            {showUpgrade ? (
              <Link
                href={upgradeHref(plan === "free" ? "growth" : "pro", "topbar")}
                className="hidden items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:border-white/20 dark:hover:bg-white/[0.04] dark:hover:text-white sm:inline-flex"
              >
                <Gem className="h-3.5 w-3.5" />
                Upgrade
              </Link>
            ) : null}
            {slug ? (
              <a
                href={`${storefrontBase}/${slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label="View your shop (opens in a new tab)"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white sm:min-h-0 transition hover:bg-slate-800 dark:border dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/[0.1]"
              >
                <Rocket className="h-3.5 w-3.5 opacity-80" />
                <span className="hidden sm:inline">View shop</span>
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sign out"
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 lg:hidden"
            >
              <LogOut className="h-4 w-4" />
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

        <main
          id="main"
          className="guma-console-main flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 lg:px-8 lg:pb-8"
        >
          <div className="mb-6">
            <h1 className="font-display text-[28px] font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          {children}
        </main>
      </div>
      </div>

      {bottomNav.length > 0 ? (
        <nav
          aria-label="Quick menu"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-white/10 dark:bg-guma-navy/95 lg:hidden"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {bottomNav.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                      active ? "text-violet-700 dark:text-violet-300" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-expanded={menuOpen}
                className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              >
                <Menu className="h-5 w-5" aria-hidden />
                More
              </button>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
