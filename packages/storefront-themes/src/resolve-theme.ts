import {
  getShopTemplate,
  isShopTemplateId,
  normalizeShopTemplateId,
  SHOP_TEMPLATES,
} from "./templates";
import { normalizeStoreLook } from "./store-look";
import type { ResolvedShopTheme, ShopTemplateId, TenantThemeJson } from "./types";

const DEFAULT_TEMPLATE_ID: ShopTemplateId = "clean-guma";

function fallbackTemplateId(subscriptionPlan?: string | null): ShopTemplateId {
  const preferred = SHOP_TEMPLATES.find(
    (template) => template.id === DEFAULT_TEMPLATE_ID && canUseTemplate(template.id, subscriptionPlan)
  );
  if (preferred) return preferred.id;

  const allowed = SHOP_TEMPLATES.find((template) =>
    canUseTemplate(template.id, subscriptionPlan)
  );
  return allowed?.id ?? DEFAULT_TEMPLATE_ID;
}

export function resolveShopTheme(
  themeJson: TenantThemeJson | null | undefined,
  shopName: string
): ResolvedShopTheme {
  const storedId = themeJson?.templateId
    ? normalizeShopTemplateId(themeJson.templateId)
    : undefined;
  const templateId =
    storedId && isShopTemplateId(storedId) ? storedId : DEFAULT_TEMPLATE_ID;

  const template = getShopTemplate(templateId);

  return {
    templateId: template.id,
    tier: template.tier,
    label: template.label,
    layout: template.layout,
    header: template.header,
    card: template.card,
    hero: template.hero,
    tagline: themeJson?.tagline?.trim() || `Welcome to ${shopName}`,
    // Fallback for shops with no saved promo: nothing a shop might not actually offer.
    promoTitle: themeJson?.promoTitle?.trim() || "Order online in a few taps",
    promoSubtitle: themeJson?.promoSubtitle?.trim() || "Message us if you have questions",
    primaryColor: themeJson?.primaryColor ?? template.tokens.primary,
    accentColor: themeJson?.accentColor ?? template.tokens.accent,
    background: template.tokens.background,
    foreground: template.tokens.foreground,
    cardBackground: template.tokens.card,
    muted: template.tokens.muted,
    border: template.tokens.border,
    mode: template.tokens.mode,
    radius: template.tokens.radius,
    displayFont: themeJson?.displayFont ?? template.tokens.displayFont,
    previewGradient: template.previewGradient,
    storeLook: normalizeStoreLook(themeJson?.storeLook),
  };
}

export function canUseTemplate(
  templateId: string,
  subscriptionPlan: string | null | undefined
): boolean {
  const normalized = normalizeShopTemplateId(templateId);
  if (!isShopTemplateId(normalized)) return false;
  const template = getShopTemplate(normalized);
  const plan = subscriptionPlan ?? "free";

  if (template.minPlan === "free") return true;
  if (template.minPlan === "growth") return plan === "growth" || plan === "pro";
  return plan === "pro";
}

/** Resolves theme and downgrades template when the saved choice exceeds the current plan. */
export function resolveShopThemeForPlan(
  themeJson: TenantThemeJson | null | undefined,
  shopName: string,
  subscriptionPlan?: string | null
): ResolvedShopTheme {
  const storedId = themeJson?.templateId
    ? normalizeShopTemplateId(themeJson.templateId)
    : undefined;
  const requestedId =
    storedId && isShopTemplateId(storedId) ? storedId : DEFAULT_TEMPLATE_ID;

  const templateId = canUseTemplate(requestedId, subscriptionPlan)
    ? requestedId
    : fallbackTemplateId(subscriptionPlan);

  if (templateId === requestedId) {
    return resolveShopTheme(themeJson, shopName);
  }

  return resolveShopTheme({ ...themeJson, templateId }, shopName);
}
