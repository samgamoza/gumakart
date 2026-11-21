/**
 * AI Social Marketing & Commerce Suite tiers (IMPLEMENTATION_PLAN.md, Phase 1).
 *
 * New sellable tiers:  free ₱0 · starter ₱999 · pro_live ₱2,999 · enterprise_vibe ₱5,999
 * Legacy tiers (grandfathered, ids stay valid forever):
 *   growth = "Pro" ₱499 · pro = "Advance" ₱999   (see catalog.ts — `pro` is NOT the new Pro Live)
 *
 * Existing feature gates keep using normalizePlanId() → free | growth | pro. Each AI-suite tier
 * declares which of those it behaves as (`legacyFeaturePlan`), so a new tier never loses a
 * feature a legacy shop at the same or lower price has.
 *
 * The `subscription_tiers` table (migration 0047) mirrors AI_SUITE_TIERS row for row; the DB copy
 * exists so credit reservation can happen atomically in SQL. ai-suite.test.ts keeps them in step.
 *
 * Client-safe — no Postgres / Node-only deps.
 */

export type AiSuiteSellableTierId = "free" | "starter" | "pro_live" | "enterprise_vibe";
export type AiSuiteLegacyTierId = "growth" | "pro";
export type AiSuiteTierId = AiSuiteSellableTierId | AiSuiteLegacyTierId;

export type AiMediaJobType = "product_photo" | "video_ad" | "voice_clone" | "printair_mockup";
export type AiMediaJobStatus = "queued" | "processing" | "completed" | "failed";
export type AiCreditKind = "photo" | "video";

/** -1 means unlimited. */
export const UNLIMITED = -1;

export interface AiSuiteEntitlements {
  photoCreditsLimit: number;
  videoCreditsLimit: number;
  aiCloserEnabled: boolean;
  broadcastEnabled: boolean;
  voiceCloneEnabled: boolean;
  vibeCodingEnabled: boolean;
  /** BullMQ priority — 1 is served first. */
  queuePriority: number;
}

export interface AiSuiteTier extends AiSuiteEntitlements {
  id: AiSuiteTierId;
  displayName: string;
  priceMonthlyPhp: number;
  isLegacy: boolean;
  isGrandfathered: boolean;
  /** What existing gates (PLAN_AI_LIMITS, planAtLeast…) treat this tier as. */
  legacyFeaturePlan: "free" | "growth" | "pro";
  sortOrder: number;
}

/** Starter's AI-media entitlements, also granted to grandfathered legacy subscribers. */
const STARTER_MEDIA: AiSuiteEntitlements = {
  photoCreditsLimit: 20,
  videoCreditsLimit: 0,
  aiCloserEnabled: false,
  broadcastEnabled: false,
  voiceCloneEnabled: false,
  vibeCodingEnabled: false,
  queuePriority: 3,
};

export const AI_SUITE_TIERS: Record<AiSuiteTierId, AiSuiteTier> = {
  free: {
    id: "free",
    displayName: "Free",
    priceMonthlyPhp: 0,
    isLegacy: false,
    isGrandfathered: false,
    legacyFeaturePlan: "free",
    photoCreditsLimit: 0,
    videoCreditsLimit: 0,
    aiCloserEnabled: false,
    broadcastEnabled: false,
    voiceCloneEnabled: false,
    vibeCodingEnabled: false,
    queuePriority: 4,
    sortOrder: 0,
  },
  starter: {
    id: "starter",
    displayName: "Starter",
    priceMonthlyPhp: 999,
    isLegacy: false,
    isGrandfathered: false,
    legacyFeaturePlan: "growth",
    ...STARTER_MEDIA,
    sortOrder: 10,
  },
  pro_live: {
    id: "pro_live",
    displayName: "Pro Live",
    priceMonthlyPhp: 2999,
    isLegacy: false,
    isGrandfathered: false,
    legacyFeaturePlan: "pro",
    photoCreditsLimit: 100,
    videoCreditsLimit: 10,
    aiCloserEnabled: true,
    broadcastEnabled: true,
    voiceCloneEnabled: false,
    vibeCodingEnabled: false,
    queuePriority: 2,
    sortOrder: 20,
  },
  enterprise_vibe: {
    id: "enterprise_vibe",
    displayName: "Enterprise Vibe",
    priceMonthlyPhp: 5999,
    isLegacy: false,
    isGrandfathered: false,
    legacyFeaturePlan: "pro",
    photoCreditsLimit: UNLIMITED,
    videoCreditsLimit: 40,
    aiCloserEnabled: true,
    broadcastEnabled: true,
    voiceCloneEnabled: true,
    vibeCodingEnabled: true,
    queuePriority: 1,
    sortOrder: 30,
  },
  growth: {
    id: "growth",
    displayName: "Pro (legacy)",
    priceMonthlyPhp: 499,
    isLegacy: true,
    isGrandfathered: true,
    legacyFeaturePlan: "growth",
    ...STARTER_MEDIA,
    sortOrder: 90,
  },
  pro: {
    id: "pro",
    displayName: "Advance (legacy)",
    priceMonthlyPhp: 999,
    isLegacy: true,
    isGrandfathered: true,
    legacyFeaturePlan: "pro",
    ...STARTER_MEDIA,
    sortOrder: 91,
  },
};

export const AI_SUITE_SELLABLE_TIERS: AiSuiteTier[] = (
  ["free", "starter", "pro_live", "enterprise_vibe"] as const
).map((id) => AI_SUITE_TIERS[id]);

/** Low-priority lane for background upsell renders (Printair mockups). */
export const PRINTAIR_MOCKUP_PRIORITY = 10;

/**
 * Any stored subscription_plan string → AI-suite tier id. Mirrors the SQL function
 * `ai_suite_tier_for_plan` in migration 0047.
 */
export function resolveAiSuiteTierId(plan: string | null | undefined): AiSuiteTierId {
  const v = (plan ?? "").trim().toLowerCase();
  if (v === "advance") return "pro";
  if (v === "" || v === "sulit") return "free";
  if (Object.prototype.hasOwnProperty.call(AI_SUITE_TIERS, v)) return v as AiSuiteTierId;
  return "free";
}

export function getAiSuiteTier(plan: string | null | undefined): AiSuiteTier {
  return AI_SUITE_TIERS[resolveAiSuiteTierId(plan)];
}

export function isAiSuiteTierId(value: string): value is AiSuiteTierId {
  return Object.prototype.hasOwnProperty.call(AI_SUITE_TIERS, value);
}

/** Which credit (if any) a media job consumes. */
export function creditKindForJob(jobType: AiMediaJobType): AiCreditKind | null {
  if (jobType === "product_photo") return "photo";
  if (jobType === "video_ad") return "video";
  return null;
}

export type MediaJobDenial = "photo_not_included" | "video_not_included" | "voice_clone_not_included";

/** Static entitlement check (no usage counters) — can this tier submit this job type at all? */
export function mediaJobDenial(
  entitlements: Pick<AiSuiteEntitlements, "photoCreditsLimit" | "videoCreditsLimit" | "voiceCloneEnabled">,
  jobType: AiMediaJobType
): MediaJobDenial | null {
  if (jobType === "product_photo" && entitlements.photoCreditsLimit === 0) return "photo_not_included";
  if (jobType === "video_ad" && entitlements.videoCreditsLimit === 0) return "video_not_included";
  if (jobType === "voice_clone" && !entitlements.voiceCloneEnabled) return "voice_clone_not_included";
  return null;
}

/** Queue priority for a job: tier priority, except Printair mockups always ride the slow lane. */
export function mediaJobPriority(tierPriority: number, jobType: AiMediaJobType): number {
  return jobType === "printair_mockup" ? PRINTAIR_MOCKUP_PRIORITY : tierPriority;
}

/** Credits left this period; null = unlimited. */
export function creditsRemaining(limit: number, used: number): number | null {
  if (limit === UNLIMITED) return null;
  return Math.max(limit - used, 0);
}
