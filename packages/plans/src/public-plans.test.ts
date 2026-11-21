import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPurchasePlan, isGrandfatheredPlan, PAID_PLAN_PRICES_PHP, PUBLIC_PLANS, tierDisplayName } from "./public-plans";

describe("public tiers (Phase 5.3 / D2)", () => {
  it("sells Free ₱0 · Starter ₱999 · Pro Live ₱2,999 · Enterprise Vibe ₱5,999", () => {
    assert.deepEqual(PUBLIC_PLANS.map((p) => [p.id, p.priceMonthly]), [["free", 0], ["starter", 999], ["pro_live", 2999], ["enterprise_vibe", 5999]]);
    assert.equal(PUBLIC_PLANS.filter((p) => p.highlighted).map((p) => p.id).join(), "pro_live");
    assert.ok(PUBLIC_PLANS.every((p) => p.features.length >= 4));
  });
  it("legacy plans keep their price but only renew", () => {
    assert.deepEqual([PAID_PLAN_PRICES_PHP.growth, PAID_PLAN_PRICES_PHP.pro], [499, 999]);
    assert.equal(canPurchasePlan("free", "pro_live"), true);
    assert.equal(canPurchasePlan("growth", "starter"), true);
    assert.equal(canPurchasePlan("growth", "growth"), true, "grandfathered renewal");
    assert.equal(canPurchasePlan("free", "growth"), false, "no longer sold");
    assert.equal(canPurchasePlan("pro", "growth"), false);
    assert.equal(canPurchasePlan("free", "free"), false);
    assert.equal(canPurchasePlan("free", "platinum"), false);
  });
  it("names", () => {
    assert.deepEqual(["starter", "pro_live", "enterprise_vibe", "growth", "pro", null].map(tierDisplayName), ["Starter", "Pro Live", "Enterprise Vibe", "Pro", "Advance", "Free"]);
    assert.equal(isGrandfatheredPlan("growth"), true);
    assert.equal(isGrandfatheredPlan("pro_live"), false);
  });
});
