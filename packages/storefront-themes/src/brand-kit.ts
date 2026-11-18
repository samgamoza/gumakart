import { SHOP_TEMPLATES } from "./templates";
import { canUseTemplate } from "./resolve-theme";
import { matchStorePattern } from "./patterns";
import { deriveStoreLook, STORE_LOOK_COMBINATIONS } from "./store-look";
import { isFoodBusinessCategory, templatePoolForSignup } from "./category-fit";
import type { ShopTemplateId, TenantThemeJson } from "./types";
import type { StoreLook } from "./store-look";
import type { ShopDisplayFont } from "./types";

/**
 * Zero-cost brand differentiation engine.
 *
 * Every new shop gets a unique-feeling starting identity derived
 * deterministically from its name + slug + chosen vibe — no LLM call, no
 * randomness that changes between renders, and no two friends landing on the
 * same default green storefront.
 */

export type ShopVibeId = "fresh" | "minimal" | "cute" | "bold" | "premium" | "electric";

export interface ShopVibe {
  id: ShopVibeId;
  emoji: string;
  label: string;
  description: string;
  /** Ordered template preference; first one the plan allows wins. */
  templates: ShopTemplateId[];
  /** Indices into BRAND_PALETTES this vibe draws from. */
  paletteIds: string[];
}

export interface BrandPalette {
  id: string;
  label: string;
  primary: string;
  accent: string;
}

/** Curated primary/accent duos — every pair passes contrast checks on light and dark templates. */
export const BRAND_PALETTES: BrandPalette[] = [
  { id: "guma-green", label: "Guma Green", primary: "#059669", accent: "#f59e0b" },
  { id: "manila-sunset", label: "Manila Sunset", primary: "#ea580c", accent: "#fbbf24" },
  { id: "ube-cream", label: "Ube Cream", primary: "#7c3aed", accent: "#fb923c" },
  { id: "sampaguita", label: "Sampaguita", primary: "#0f766e", accent: "#fde047" },
  { id: "dragonfruit", label: "Dragonfruit", primary: "#db2777", accent: "#4ade80" },
  { id: "halo-halo", label: "Halo-Halo", primary: "#9333ea", accent: "#f472b6" },
  { id: "island-blue", label: "Island Blue", primary: "#0284c7", accent: "#fb7185" },
  { id: "mango-royale", label: "Mango Royale", primary: "#d97706", accent: "#84cc16" },
  { id: "midnight-neon", label: "Midnight Neon", primary: "#6366f1", accent: "#22d3ee" },
  { id: "calamansi", label: "Calamansi", primary: "#65a30d", accent: "#facc15" },
  { id: "taho-caramel", label: "Taho Caramel", primary: "#b45309", accent: "#fcd34d" },
  { id: "coral-reef", label: "Coral Reef", primary: "#e11d48", accent: "#2dd4bf" },
  { id: "ink-slate", label: "Ink & Slate", primary: "#1e293b", accent: "#94a3b8" },
  { id: "espresso", label: "Espresso", primary: "#44403c", accent: "#d6d3d1" },
  { id: "orchid-noir", label: "Orchid Noir", primary: "#a21caf", accent: "#e879f9" },
  { id: "electric-lime", label: "Electric Lime", primary: "#16a34a", accent: "#a3e635" },
  { id: "bubblegum", label: "Bubblegum", primary: "#ec4899", accent: "#93c5fd" },
  { id: "cyber-grape", label: "Cyber Grape", primary: "#8b5cf6", accent: "#5eead4" },
];

export const SHOP_VIBES: ShopVibe[] = [
  {
    id: "fresh",
    emoji: "🌿",
    label: "Fresh & friendly",
    description: "Clean, trustworthy, everyday shopping",
    templates: ["clean-guma", "bloom", "blush-bakery", "mono-market"],
    paletteIds: ["guma-green", "sampaguita", "calamansi", "island-blue", "electric-lime"],
  },
  {
    id: "minimal",
    emoji: "◻️",
    label: "Minimal & sharp",
    description: "High contrast, zero clutter, premium type",
    templates: ["bloom", "mono-market", "magazine-rack", "clean-guma"],
    paletteIds: ["ink-slate", "espresso", "guma-green", "island-blue"],
  },
  {
    id: "cute",
    emoji: "🧁",
    label: "Cute & cozy",
    description: "Soft pastels and IG-worthy warmth",
    templates: ["simply-sweet", "blush-bakery", "clean-guma", "y2k-chrome"],
    paletteIds: ["bubblegum", "halo-halo", "dragonfruit", "taho-caramel", "coral-reef"],
  },
  {
    id: "bold",
    emoji: "🔥",
    label: "Bold & loud",
    description: "Street-market energy with big CTAs",
    templates: ["street-cart", "sarab", "clean-guma", "neon-bazaar"],
    paletteIds: ["manila-sunset", "mango-royale", "coral-reef", "calamansi", "dragonfruit"],
  },
  {
    id: "premium",
    emoji: "✨",
    label: "Premium & sleek",
    description: "Editorial layouts for curated brands",
    templates: ["magazine-rack", "furnish", "glass-future", "mono-market"],
    paletteIds: ["ube-cream", "orchid-noir", "ink-slate", "espresso", "cyber-grape"],
  },
  {
    id: "electric",
    emoji: "⚡",
    label: "Electric & hype",
    description: "Dark mode, neon accents, TikTok-era",
    templates: ["neon-bazaar", "holo-grid", "mono-market"],
    paletteIds: ["midnight-neon", "cyber-grape", "electric-lime", "orchid-noir", "halo-halo"],
  },
];

const VIBE_MAP = Object.fromEntries(SHOP_VIBES.map((v) => [v.id, v])) as Record<
  ShopVibeId,
  ShopVibe
>;

export function isShopVibeId(value: string): value is ShopVibeId {
  return value in VIBE_MAP;
}

const PROMO_COPY_RETAIL: Array<{ title: string; subtitle: string }> = [
  { title: "Free delivery on orders ₱500+", subtitle: "Metro Manila · Until 9 PM" },
  { title: "Opening promo — 10% off first orders", subtitle: "This week only · While stocks last" },
  { title: "Same-day delivery available", subtitle: "Order before 3 PM · GCash & COD accepted" },
  { title: "Buy 2, get free delivery", subtitle: "Automatic at checkout · No code needed" },
  { title: "Fresh drops every week", subtitle: "Follow us so you don't miss out" },
  { title: "GCash, Maya & COD accepted", subtitle: "Fast checkout · No app download needed" },
  { title: "New here? Say hi for a freebie 🎁", subtitle: "Message us after your first order" },
  { title: "Handled with care, shipped fast", subtitle: "Packed same day · Tracked delivery" },
];

// Non-retail starter copy. Every line is something any shop in the group can truthfully show
// before the seller edits it: no invented discounts, free offers, delivery promises or numbers.
const PROMO_COPY_FINANCIAL: Array<{ title: string; subtitle: string }> = [
  { title: "Protection that grows with you", subtitle: "Family · Business · Retirement" },
  { title: "Plans built around your goals", subtitle: "Transparent options · Local support" },
  { title: "Talk to an advisor", subtitle: "Message us to set an appointment" },
  { title: "Know your options before you commit", subtitle: "Ask us anything · No pressure" },
];

const PROMO_COPY_PROFESSIONAL: Array<{ title: string; subtitle: string }> = [
  { title: "Book a consultation", subtitle: "Clear next steps · No pressure" },
  { title: "Tell us what you need", subtitle: "Message us and we'll reply with next steps" },
  { title: "Trusted help when you need it", subtitle: "Local team · Straight answers" },
  { title: "Request a quote", subtitle: "Share the details and we'll get back to you" },
];

const PROMO_COPY_SERVICE: Array<{ title: string; subtitle: string }> = [
  { title: "Book your schedule with us", subtitle: "Message us for available slots" },
  { title: "Request a quote", subtitle: "Send photos or details · We reply with a price" },
  { title: "Serving your area", subtitle: "Message us to check if we cover your location" },
  { title: "Easy booking, no app needed", subtitle: "Message us or book online" },
];

const TAGLINE_PATTERNS_RETAIL: Array<(shopName: string, category: string) => string> = [
  (name) => `Welcome to ${name}`,
  (name) => `${name} — made with love, delivered fast`,
  (name, category) => `Your neighborhood ${category.toLowerCase()} shop`,
  (name) => `Thanks for dropping by ${name}`,
  (name) => `${name} · order in seconds, no app needed`,
  (name, category) => `Small-batch ${category.toLowerCase()}, big heart`,
];

const TAGLINE_PATTERNS_FINANCIAL: Array<(shopName: string, category: string) => string> = [
  (name) => `Welcome to ${name}`,
  (name) => `${name} — clarity you can act on`,
  (name) => `${name} · advice first, products second`,
  (name) => `Protect what matters with ${name}`,
  (name) => `${name} — planning for every stage of life`,
];

const TAGLINE_PATTERNS_PROFESSIONAL: Array<(shopName: string, category: string) => string> = [
  (name) => `Welcome to ${name}`,
  (name) => `${name} — clarity you can act on`,
  (name) => `${name} · straight answers, clear next steps`,
  (name) => `Tell ${name} what you need`,
  (name) => `${name} · local experts you can reach`,
];

const TAGLINE_PATTERNS_SERVICE: Array<(shopName: string, category: string) => string> = [
  (name) => `Welcome to ${name}`,
  (name) => `Book ${name} without the back-and-forth`,
  (name) => `${name} · message us, we'll take it from there`,
  (name) => `${name} — service near you`,
];

export type BrandCopyGroup = "financial" | "professional" | "service" | "retail";

const FINANCIAL_RE = /insurance|financ|fintech|banking|lending|loan/i;
const PROFESSIONAL_RE = /consult|professional|legal|lawyer|law firm|account|bookkeep|tax|real.?estate|property|broker|education|training|tutor|school|healthcare|clinic|dental|medical/i;
const SERVICE_RE = /service|repair|hvac|air.?con|pest|construction|renovat|painting|decorat|cleaning|janitor|laundry|landscap|garden|solar|renewable|security|surveillance|photograph|creative|events?|wedding|entertain|logistic|shipping|courier|hotel|resort|travel|tour|childcare|daycare|fitness|wellness|gym|attraction|leisure|salon|spa|barber|car.?wash|detailing|auto.?body|auto shop|mechanic|plumb|electrician/i;

/**
 * Which starter copy a category gets. Order matters: financial before professional (both are
 * advice businesses, only one sells protection plans); food always counts as retail.
 */
export function brandCopyGroupOf(category: string): BrandCopyGroup {
  if (isFoodBusinessCategory(category)) return "retail";
  if (FINANCIAL_RE.test(category)) return "financial";
  if (PROFESSIONAL_RE.test(category)) return "professional";
  if (SERVICE_RE.test(category)) return "service";
  return "retail";
}

const PROMO_BY_GROUP: Record<BrandCopyGroup, Array<{ title: string; subtitle: string }>> = {
  financial: PROMO_COPY_FINANCIAL,
  professional: PROMO_COPY_PROFESSIONAL,
  service: PROMO_COPY_SERVICE,
  retail: PROMO_COPY_RETAIL,
};

const TAGLINES_BY_GROUP: Record<BrandCopyGroup, Array<(shopName: string, category: string) => string>> = {
  financial: TAGLINE_PATTERNS_FINANCIAL,
  professional: TAGLINE_PATTERNS_PROFESSIONAL,
  service: TAGLINE_PATTERNS_SERVICE,
  retail: TAGLINE_PATTERNS_RETAIL,
};

/** FNV-1a — tiny, stable, good spread for short strings. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  return items[(seed + salt * 2654435761) % items.length] as T;
}

const CATEGORY_VIBE_HINTS: Array<{ match: RegExp; vibe: ShopVibeId }> = [
  { match: /insurance|financial|fintech|banking|lending/i, vibe: "premium" },
  { match: /professional|consult|agency|accountant|lawyer|legal/i, vibe: "minimal" },
  { match: /healthcare|clinic|dental|wellness|fitness/i, vibe: "minimal" },
  { match: /real.?estate|property|broker/i, vibe: "premium" },
  { match: /bakery|pastry|cake|dessert|sweet|home.?baking|vlog|recipe/i, vibe: "cute" },
  { match: /catering|events?|party.?food|banquet/i, vibe: "bold" },
  { match: /furniture|furnish|home.?decor|interior|sofa|living room/i, vibe: "premium" },
  { match: /beauty|skincare|cosmetic|salon|spa|nail|hair/i, vibe: "premium" },
  { match: /electronic|gadget|tech|gaming/i, vibe: "electric" },
  { match: /auto|automotive|car|motor|mechanic|tire/i, vibe: "electric" },
  { match: /print|signage|banner|sticker|lanyard/i, vibe: "minimal" },
  { match: /camp|outdoor|adventure|hike|trek|travel gear/i, vibe: "bold" },
  { match: /wholesale|b2b|bulk|distributor|reseller/i, vibe: "minimal" },
  { match: /retail|merchandise|general store|sari-sari|convenience/i, vibe: "minimal" },
  // Food only — do NOT use bare "drink" (false-positives) or match non-food categories
  { match: /food\s*&\s*beverage|^food$|beverage|snack|restaurant|fast.?food|kitchen/i, vibe: "bold" },
  { match: /handmade|craft|gift/i, vibe: "cute" },
];

export interface DeriveBrandKitInput {
  shopName: string;
  slug: string;
  category?: string;
  /** Seller-chosen vibe; falls back to a category-based guess, then hash rotation. */
  vibe?: string;
  subscriptionPlan?: string | null;
}

const DISPLAY_FONTS: ShopDisplayFont[] = ["bricolage", "system", "mono-accent"];

export interface DerivedBrandKit extends TenantThemeJson {
  patternId: import("./types").StorePatternId;
  templateId: ShopTemplateId;
  primaryColor: string;
  accentColor: string;
  paletteId: string;
  vibe: ShopVibeId;
  displayFont: ShopDisplayFont;
  storeLook: StoreLook;
}

export function deriveBrandKit(input: DeriveBrandKitInput): DerivedBrandKit {
  const category = input.category?.trim() || "General";
  const seed = hashString(`${input.slug}::${input.shopName.trim().toLowerCase()}`);

  let vibe: ShopVibe | undefined =
    input.vibe && isShopVibeId(input.vibe) ? VIBE_MAP[input.vibe] : undefined;
  if (!vibe) {
    const hint = CATEGORY_VIBE_HINTS.find((h) => h.match.test(category));
    vibe = hint ? VIBE_MAP[hint.vibe] : pick(SHOP_VIBES, seed, 1);
  }

  const plan = input.subscriptionPlan ?? "free";
  // Category wins over vibe — never put an insurance shop on a food menu skin.
  const categoryPool = templatePoolForSignup(category, vibe.templates).filter((id) =>
    canUseTemplate(id, plan)
  );
  const fallbackTemplates = SHOP_TEMPLATES.filter(
    (t) => canUseTemplate(t.id, plan) && templatePoolForSignup(category, [t.id]).includes(t.id)
  ).map((t) => t.id);
  const templatePool =
    categoryPool.length > 0
      ? categoryPool
      : fallbackTemplates.length > 0
        ? fallbackTemplates
        : (["clean-guma", "mono-market"] as ShopTemplateId[]);
  // Prefer first preferred templates; hash only spreads within the safe pool.
  const templateId = pick(templatePool.slice(0, Math.min(4, templatePool.length)), seed, 2);

  const palettePool = BRAND_PALETTES.filter((p) => vibe.paletteIds.includes(p.id));
  const palette = pick(palettePool.length > 0 ? palettePool : BRAND_PALETTES, seed, 3);

  const copyGroup = brandCopyGroupOf(category);
  const promo = pick(PROMO_BY_GROUP[copyGroup], seed, 4);
  const taglineFn = pick(TAGLINES_BY_GROUP[copyGroup], seed, 5);
  const displayFont = pick(DISPLAY_FONTS, seed, 6);
  const storeLook = deriveStoreLook(seed);
  const patternId = matchStorePattern({
    category,
    vibe: vibe.id,
    templateId,
  });

  return {
    templateId,
    patternId,
    primaryColor: palette.primary,
    accentColor: palette.accent,
    paletteId: palette.id,
    vibe: vibe.id,
    displayFont,
    storeLook,
    tagline: taglineFn(input.shopName.trim(), category),
    promoTitle: promo.title,
    promoSubtitle: promo.subtitle,
  };
}

/**
 * Distinct starting identities the deterministic engine can produce
 * (before the seller touches a single setting):
 *   free plan  : templates × palettes × promos × taglines × fonts × storeLook
 * Custom colors / logo / cover make production space effectively unbounded.
 */
export const BRAND_KIT_COMBINATIONS = {
  lookKnobs: STORE_LOOK_COMBINATIONS,
  free:
    3 *
    BRAND_PALETTES.length *
    PROMO_COPY_RETAIL.length *
    TAGLINE_PATTERNS_RETAIL.length *
    DISPLAY_FONTS.length *
    STORE_LOOK_COMBINATIONS,
  growth:
    6 *
    BRAND_PALETTES.length *
    PROMO_COPY_RETAIL.length *
    TAGLINE_PATTERNS_RETAIL.length *
    DISPLAY_FONTS.length *
    STORE_LOOK_COMBINATIONS,
  pro:
    9 *
    BRAND_PALETTES.length *
    PROMO_COPY_RETAIL.length *
    TAGLINE_PATTERNS_RETAIL.length *
    DISPLAY_FONTS.length *
    STORE_LOOK_COMBINATIONS,
};
