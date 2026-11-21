/**
 * Canonical seller plan catalog (ADR-0001 D4).
 *
 * DB / billing IDs (stable forever): `free` · `growth` · `pro`
 * Constitution labels: Free · Pro · Advance
 * Handbook: FREE→free, PRO→growth, ADVANCE→pro
 *
 * No business logic may define plan prices, features, or limits outside this package.
 * Client-safe — no Postgres / Node-only deps.
 */

export type SubscriptionPlanId = "free" | "growth" | "pro";

/** @deprecated Prefer SubscriptionPlanId — alias for AI/permission imports */
export type SubscriptionPlan = SubscriptionPlanId;

export type ConstitutionPlanLabel = "Free" | "Pro" | "Advance";

export interface PlanDefinition {
  id: SubscriptionPlanId;
  /** Seller-facing display name (matches constitution) */
  name: string;
  constitutionLabel: ConstitutionPlanLabel;
  priceMonthly: number;
  tagline: string;
  features: string[];
  /** Marketing bullets used on landing / subscription cards */
  marketingFeatures: string[];
  /** Workspace AI features unlocked */
  workspaceEnabled: boolean;
  /** Soft product catalog hint (marketing; not hard-enforced everywhere) */
  productCap: number | null;
}

export const SELLER_PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    constitutionLabel: "Free",
    priceMonthly: 0,
    tagline: "Launch your store in minutes",
    features: [
      "GUMA Launch wizard",
      "Curated templates",
      "GCash, Maya & COD checkout",
      "Up to 20 products",
    ],
    marketingFeatures: [
      "GUMA Launch wizard",
      "5 AI generations / month",
      "Shop chatbot (daily limits)",
      "GCash & COD",
      "Order-update texts to buyers",
      "Up to 20 products",
    ],
    workspaceEnabled: false,
    productCap: 20,
  },
  {
    id: "growth",
    name: "Pro",
    constitutionLabel: "Pro",
    priceMonthly: 499,
    tagline: "AI Workspace for growing shops",
    features: [
      "Everything in Free",
      "Change storefront template after publish",
      "GUMA Workspace",
      "AI content & campaigns",
      "Posting agents",
      "Unlimited products",
    ],
    marketingFeatures: [
      "Everything in Free",
      "Change storefront template anytime",
      "GUMA Workspace",
      "100 AI generations / month",
      "Live selling & agents",
      "Unlimited products",
      "Follow-up texts: reminders, thank-you notes, review requests",
      "SMS campaigns with AI-written promos",
    ],
    workspaceEnabled: true,
    productCap: null,
  },
  {
    id: "pro",
    name: "Advance",
    constitutionLabel: "Advance",
    priceMonthly: 999,
    tagline: "Full AI commerce operating system",
    features: [
      "Everything in Pro",
      "Advanced templates",
      "Priority support",
      "Smart pricing & live selling (roadmap)",
    ],
    marketingFeatures: [
      "Everything in Pro",
      "500 AI generations / month",
      "Advanced campaign agents",
      "Higher AI limits",
      "Priority support",
    ],
    workspaceEnabled: true,
    productCap: null,
  },
];

export const PLAN_PRICES_PHP: Record<"growth" | "pro", number> = {
  growth: 499,
  pro: 999,
};

export const PLAN_PERIOD_DAYS = 30;

export const PLAN_ORDER: Record<SubscriptionPlanId, number> = {
  free: 0,
  growth: 1,
  pro: 2,
};

/**
 * Normalize any stored / legacy / marketing alias to a canonical plan id.
 * - starter → growth (AI-suite Starter tier; also the legacy platform alias)
 * - advance → pro (constitution spelling)
 * - pro_live, enterprise_vibe → pro (AI-suite tiers get every Advance feature; see ai-suite.ts)
 * - sulit → free (legacy marketing)
 */
export function normalizePlanId(id: string | null | undefined): SubscriptionPlanId {
  const raw = (id ?? "").trim().toLowerCase();
  if (raw === "pro" || raw === "advance" || raw === "pro_live" || raw === "enterprise_vibe") return "pro";
  if (raw === "growth" || raw === "starter") return "growth";
  if (raw === "free" || raw === "sulit" || raw === "") return "free";
  return "free";
}

/** @deprecated Use normalizePlanId */
export const normalizePlan = normalizePlanId;

export function getSellerPlan(id: string | null | undefined): PlanDefinition {
  const normalized = normalizePlanId(id);
  return SELLER_PLANS.find((p) => p.id === normalized) ?? SELLER_PLANS[0]!;
}

export function planPriceMonthly(id: string | null | undefined): number {
  return getSellerPlan(id).priceMonthly;
}

export function planDisplayName(id: string | null | undefined): string {
  return getSellerPlan(id).name;
}

export function planAtLeast(
  current: string | null | undefined,
  required: SubscriptionPlanId
): boolean {
  return PLAN_ORDER[normalizePlanId(current)] >= PLAN_ORDER[required];
}

export function upgradeHref(
  highlight: Exclude<SubscriptionPlanId, "free">,
  ref?: string
): string {
  const params = new URLSearchParams({ highlight });
  if (ref) params.set("ref", ref);
  return `/settings/subscription?${params.toString()}`;
}

export function planBadgeLabel(required: SubscriptionPlanId): string {
  if (required === "pro") return "Advance+";
  if (required === "growth") return "Pro+";
  return "Free";
}

/** Compact client list for platform dropdowns */
export const CLIENT_PLANS = SELLER_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  priceMonthly: p.priceMonthly,
  constitutionLabel: p.constitutionLabel,
}));

/** @deprecated Use SELLER_PLANS — kept for platform MRR during migration */
export const PLATFORM_PLANS = SELLER_PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  priceMonthly: p.priceMonthly,
  tagline: p.tagline,
  features: p.features,
}));
