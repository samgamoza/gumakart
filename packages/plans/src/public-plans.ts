/**
 * AI suite Phase 5.3 (decision D2) — what public pricing and checkout sell from now on:
 *   Free ₱0 · Starter ₱999 · Pro Live ₱2,999 · Enterprise Vibe ₱5,999 (per month).
 * Grandfathered legacy subscribers keep their plan and price: `growth` ("Pro", ₱499) and `pro`
 * ("Advance", ₱999) can still RENEW, but nobody new can buy them.
 *
 * Client-safe — no Postgres / Node-only deps.
 */
import { AI_SUITE_TIERS, UNLIMITED, type AiSuiteTierId } from "./ai-suite";
import { PLAN_AI_LIMITS } from "./ai-limits";

export type PublicPlanId = "free" | "starter" | "pro_live" | "enterprise_vibe";
export type PaidPlanId = Exclude<PublicPlanId, "free"> | "growth" | "pro";

export interface PublicPlan {
  id: PublicPlanId;
  name: string;
  priceMonthly: number;
  tagline: string;
  features: string[];
  highlighted: boolean;
}

const credits = (n: number, what: string) => (n === UNLIMITED ? `Unlimited ${what}` : `${n} ${what} / month`);
const ai = (tier: AiSuiteTierId) => PLAN_AI_LIMITS[AI_SUITE_TIERS[tier].legacyFeaturePlan];

export const PUBLIC_PLANS: PublicPlan[] = [
  {
    id: "free",
    name: AI_SUITE_TIERS.free.displayName,
    priceMonthly: AI_SUITE_TIERS.free.priceMonthlyPhp,
    tagline: "Launch your store in minutes",
    features: ["GUMA Launch wizard & templates", "GCash, Maya & COD checkout links", `${ai("free").generationsPerMonth} AI generations / month`, "Messenger & Instagram inbox", "Up to 20 products"],
    highlighted: false,
  },
  {
    id: "starter",
    name: AI_SUITE_TIERS.starter.displayName,
    priceMonthly: AI_SUITE_TIERS.starter.priceMonthlyPhp,
    tagline: "AI studio photos & comment-to-DM",
    features: [
      "Everything in Free, unlimited products",
      credits(AI_SUITE_TIERS.starter.photoCreditsLimit, "AI studio product photos"),
      "Taglish viral copywriter",
      "Comment-to-DM auto replies (HM / Mine / Avail pa?)",
      "Abandoned-cart nudges & review loop",
      `${ai("starter").generationsPerMonth} AI generations / month`,
    ],
    highlighted: false,
  },
  {
    id: "pro_live",
    name: AI_SUITE_TIERS.pro_live.displayName,
    priceMonthly: AI_SUITE_TIERS.pro_live.priceMonthlyPhp,
    tagline: "24/7 Taglish AI sales closer",
    features: [
      "Everything in Starter",
      "24/7 AI sales closer on Messenger, IG & WhatsApp",
      credits(AI_SUITE_TIERS.pro_live.photoCreditsLimit, "studio photos"),
      credits(AI_SUITE_TIERS.pro_live.videoCreditsLimit, "AI video ads"),
      "Payday & restock broadcasts to VIP / payday buyers",
      "AI-personalised cart recovery",
    ],
    highlighted: true,
  },
  {
    id: "enterprise_vibe",
    name: AI_SUITE_TIERS.enterprise_vibe.displayName,
    priceMonthly: AI_SUITE_TIERS.enterprise_vibe.priceMonthlyPhp,
    tagline: "Your brand voice, unlimited studio",
    features: [
      "Everything in Pro Live",
      credits(AI_SUITE_TIERS.enterprise_vibe.photoCreditsLimit, "studio photos"),
      credits(AI_SUITE_TIERS.enterprise_vibe.videoCreditsLimit, "AI video ads"),
      "Custom cloned voice for video ads",
      "Fastest GPU queue",
      "Priority support",
    ],
    highlighted: false,
  },
];

/** What each paid plan costs for 30 days (legacy ids only for grandfathered renewals). */
export const PAID_PLAN_PRICES_PHP: Record<PaidPlanId, number> = {
  starter: AI_SUITE_TIERS.starter.priceMonthlyPhp,
  pro_live: AI_SUITE_TIERS.pro_live.priceMonthlyPhp,
  enterprise_vibe: AI_SUITE_TIERS.enterprise_vibe.priceMonthlyPhp,
  growth: AI_SUITE_TIERS.growth.priceMonthlyPhp,
  pro: AI_SUITE_TIERS.pro.priceMonthlyPhp,
};

export const PUBLIC_PAID_PLAN_IDS = ["starter", "pro_live", "enterprise_vibe"] as const;
export const LEGACY_PLAN_IDS = ["growth", "pro"] as const;

/**
 * May this shop buy `target` now? New tiers: always. Legacy tiers: only to renew the plan the
 * shop is already on (grandfathering) — they are no longer sold.
 */
export function canPurchasePlan(currentPlan: string | null | undefined, target: string): target is PaidPlanId {
  if ((PUBLIC_PAID_PLAN_IDS as readonly string[]).includes(target)) return true;
  if ((LEGACY_PLAN_IDS as readonly string[]).includes(target)) return (currentPlan ?? "").trim().toLowerCase() === target;
  return false;
}

/** Seller-facing name for any stored plan id (new tiers by their own name; legacy as before). */
export function tierDisplayName(plan: string | null | undefined): string {
  const v = (plan ?? "").trim().toLowerCase();
  if (v === "starter" || v === "pro_live" || v === "enterprise_vibe") return AI_SUITE_TIERS[v].displayName;
  if (v === "growth") return "Pro";
  if (v === "pro" || v === "advance") return "Advance";
  return "Free";
}

export function isGrandfatheredPlan(plan: string | null | undefined): boolean {
  const v = (plan ?? "").trim().toLowerCase();
  return v === "growth" || v === "pro" || v === "advance";
}
