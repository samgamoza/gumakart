import type { ResolvedShopTheme } from "@gumakart/storefront-themes";
import { PAID_PLAN_PRICES_PHP, tierDisplayName } from "@gumakart/plans";
import { hasGrowthFeatures, hasProFeatures, upgradeUrl } from "@/lib/storefront-plans";
import { PlanTierBadge } from "./plan-tier-badge";

export function UpgradeHintBanner({
  plan,
  theme,
}: {
  plan?: string | null;
  theme: ResolvedShopTheme;
}) {
  if (hasProFeatures(plan)) return null;

  const growthUrl = upgradeUrl("growth");
  const proUrl = upgradeUrl("pro");

  const maxWidth = theme.layout === "classic" ? "max-w-6xl" : "max-w-lg";

  return (
    <div className={`mx-auto ${maxWidth} px-4 py-3 md:px-8`}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-xs"
        style={{
          borderRadius: theme.radius,
          border: `1px solid ${theme.primaryColor}33`,
          background: `linear-gradient(135deg, ${theme.primaryColor}14, ${theme.accentColor}18)`,
          color: theme.foreground,
        }}
      >
        <span className="font-semibold">Premium storefront</span>
        <span style={{ color: theme.muted }}>
          Sections marked <PlanTierBadge tier="growth" className="mx-0.5 align-middle" /> or{" "}
          <PlanTierBadge tier="pro" className="mx-0.5 align-middle" /> unlock on paid plans.
        </span>
        {!hasGrowthFeatures(plan) && (
          <a
            href={growthUrl}
            className="font-semibold underline-offset-2 hover:underline"
            style={{ color: theme.primaryColor }}
          >
            {tierDisplayName("starter")} from ₱{PAID_PLAN_PRICES_PHP.starter.toLocaleString("en-PH")}/mo
          </a>
        )}
        {!hasProFeatures(plan) && (
          <a
            href={proUrl}
            className="font-semibold underline-offset-2 hover:underline"
            style={{ color: theme.accentColor }}
          >
            {tierDisplayName("pro_live")} from ₱{PAID_PLAN_PRICES_PHP.pro_live.toLocaleString("en-PH")}/mo
          </a>
        )}
      </div>
    </div>
  );
}
