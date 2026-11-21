/**
 * Client-safe re-export of the canonical plan catalog (ADR D4).
 * Prefer importing `@gumakart/plans` directly in new code.
 */
export { CLIENT_PLANS, SELLER_PLANS } from "@gumakart/plans";

export type ClientPlan = (typeof import("@gumakart/plans").CLIENT_PLANS)[number];

import { AI_SUITE_TIERS, AI_SUITE_SELLABLE_TIERS } from "@gumakart/plans";

/**
 * Plans a super-admin can put a shop on: the AI-suite tiers plus the grandfathered legacy ids
 * (growth = Pro ₱499, pro = Advance ₱999), which existing subscribers keep.
 */
export const ADMIN_ASSIGNABLE_PLANS: Array<{ id: string; name: string; priceMonthly: number }> = [
  ...AI_SUITE_SELLABLE_TIERS.map((t) => ({ id: t.id, name: t.displayName, priceMonthly: t.priceMonthlyPhp })),
  ...(["growth", "pro"] as const).map((id) => ({
    id,
    name: AI_SUITE_TIERS[id].displayName,
    priceMonthly: AI_SUITE_TIERS[id].priceMonthlyPhp,
  })),
];
