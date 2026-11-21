import { planAtLeast } from "@gumakart/plans";
import { FUNNEL_RECIPES, type BuyerRecipe } from "@gumakart/services";

/**
 * The follow-up funnel (unfinished-checkout and unpaid reminders, review request, thank-you note,
 * SMS campaigns) is a Pro plan feature (stored id `growth`; Advance `pro` includes it).
 * Order-update texts stay on every plan.
 */
export const FUNNEL_MIN_PLAN = "growth" as const;

export function planHasFunnel(plan: string | null | undefined): boolean {
  return planAtLeast(plan, FUNNEL_MIN_PLAN);
}

export function recipeAllowedOnPlan(recipe: BuyerRecipe, plan: string | null | undefined): boolean {
  return !FUNNEL_RECIPES.has(recipe) || planHasFunnel(plan);
}

export const FUNNEL_UPGRADE_MESSAGE = "Follow-up texts and SMS campaigns are part of the Pro plan. Upgrade to turn them on.";
