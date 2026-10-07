export const SHOP_TEMPLATE_IDS = [
  "clean-guma",
  "mono-market",
  "blush-bakery",
  "simply-sweet",
  "neon-bazaar",
  "street-cart",
  "magazine-rack",
  "glass-future",
  "y2k-chrome",
  "holo-grid",
  "bloom",
  "sarab",
  "furnish",
  "zay",
  "electro",
  "kaira",
  "foodmart",
  "stylish",
  "mellow",
  "organic",
  "waggy",
  "fruitables",
  "ministore",
  "aircon",
  "carserv",
  "motto",
  "studio",
  "haircut",
  "specialty",
  "palenke",
] as const;

export const STORE_PATTERN_IDS = ["classic", "simply-sweet", "bloom", "sarab", "furnish", "zay", "electro", "kaira", "foodmart", "stylish", "mellow", "organic", "waggy", "fruitables", "ministore", "aircon", "carserv", "motto", "studio", "haircut", "specialty", "palenke"] as const;
export type StorePatternId = (typeof STORE_PATTERN_IDS)[number];
export type StorefrontRenderer = "themed" | "experience" | "sweet-kitchen" | "bloom" | "sarab" | "furnish" | "zay" | "electro" | "kaira" | "foodmart" | "stylish" | "mellow" | "organic" | "waggy" | "fruitables" | "ministore" | "aircon" | "carserv" | "motto" | "studio" | "haircut" | "specialty" | "palenke";
export type DashboardRenderer = "guma" | "sweet-kitchen";

export type ShopTemplateId = (typeof SHOP_TEMPLATE_IDS)[number];
export type ShopTemplateTier = "basic" | "standard" | "advanced";
export type ShopLayout = "classic" | "hero-stack" | "bento" | "editorial" | "immersive";
export type ShopHeaderStyle = "standard" | "floating-glass" | "minimal" | "split" | "sticker";
export type ShopCardStyle = "row" | "grid" | "glass-tile" | "brutal" | "magazine";
export type ShopHeroStyle = "gradient" | "mesh" | "chrome" | "noise" | "photo";

export type ShopDisplayFont = "bricolage" | "system" | "mono-accent";

export type {
  StoreFloatCardMode,
  StoreHeroLayout,
  StoreLook,
  StoreMarqueeMode,
  StoreMenuColumns,
  StoreRadiusTone,
  StoreTypeScale,
} from "./store-look";

export interface TenantThemeJson {
  templateId?: string;
  /** Paired storefront + dashboard experience (e.g. Simply Sweet kitchen + vlog shops). */
  patternId?: StorePatternId | string;
  primaryColor?: string;
  accentColor?: string;
  displayFont?: ShopDisplayFont;
  paletteId?: string;
  vibe?: string;
  tagline?: string;
  promoTitle?: string;
  promoSubtitle?: string;
  /**
   * Within-template layout knobs (hero / marquee / menu / type).
   * Deterministic at signup so two Sarab shops still look different.
   * Partial is allowed in stored JSON; resolveShopTheme normalizes.
   */
  storeLook?: Partial<import("./store-look").StoreLook>;
  /** Free Bundle curated pick (proposedId) — may differ from live templateId. */
  catalogId?: string;
  catalogLabel?: string;
}

export interface StorePatternDefinition {
  id: StorePatternId;
  label: string;
  description: string;
  tags: string[];
  /** Categories / niches where this pattern is a strong default. */
  categoryHints: RegExp[];
  templateId: ShopTemplateId;
  storefrontRenderer: StorefrontRenderer;
  dashboardRenderer: DashboardRenderer;
}

export interface ShopTemplateDefinition {
  id: ShopTemplateId;
  tier: ShopTemplateTier;
  label: string;
  description: string;
  mood: string;
  tags: string[];
  previewGradient: string;
  minPlan: "free" | "growth" | "pro";
  layout: ShopLayout;
  header: ShopHeaderStyle;
  card: ShopCardStyle;
  hero: ShopHeroStyle;
  tokens: {
    primary: string;
    accent: string;
    background: string;
    foreground: string;
    card: string;
    muted: string;
    border: string;
    mode: "light" | "dark";
    radius: string;
    displayFont: ShopDisplayFont;
  };
}

export interface ResolvedShopTheme {
  templateId: ShopTemplateId;
  tier: ShopTemplateTier;
  label: string;
  layout: ShopLayout;
  header: ShopHeaderStyle;
  card: ShopCardStyle;
  hero: ShopHeroStyle;
  tagline: string;
  promoTitle: string;
  promoSubtitle: string;
  primaryColor: string;
  accentColor: string;
  background: string;
  foreground: string;
  cardBackground: string;
  muted: string;
  border: string;
  mode: "light" | "dark";
  radius: string;
  displayFont: ShopDisplayFont;
  previewGradient: string;
  /** Within-template look knobs — omitted on older demos; normalize at render. */
  storeLook?: import("./store-look").StoreLook;
}
