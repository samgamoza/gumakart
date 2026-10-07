import { resolveStorePattern, getStorePattern } from "@gumakart/storefront-themes";
import { ThemedStorefrontHome } from "@/components/storefront/themed-home";
import type { DemoTenant } from "@/lib/demo-data";
import dynamic from "next/dynamic";
import { ThemeRenderer } from "@/components/storefront/theme-renderer";

const StorefrontExperience = dynamic(() =>
  import("@/components/storefront/experience/storefront-experience").then((m) => ({
    default: m.StorefrontExperience,
  }))
);

/** Themes rendered by the client-side switch (one chunk per theme). */
const THEME_RENDERER_IDS = new Set<string>(["sweet-kitchen", "bloom", "sarab", "furnish", "zay", "electro", "kaira", "foodmart", "stylish", "mellow", "organic", "waggy", "fruitables", "ministore", "aircon", "carserv", "motto", "studio", "haircut", "specialty", "palenke"]);

export function TenantStorefrontHome({
  tenant,
  activeCategorySlug,
}: {
  tenant: DemoTenant;
  activeCategorySlug?: string;
  utmLabel?: string;
}) {
  const patternId = tenant.patternId ?? resolveStorePattern({ templateId: tenant.shopTheme.templateId });
  const pattern = getStorePattern(patternId);

  if (THEME_RENDERER_IDS.has(pattern.storefrontRenderer)) {
    return <ThemeRenderer renderer={pattern.storefrontRenderer} tenant={tenant} />;
  }

  if (pattern.storefrontRenderer === "experience") {
    return <StorefrontExperience tenant={tenant} activeCategorySlug={activeCategorySlug} />;
  }

  return <ThemedStorefrontHome tenant={tenant} />;
}
