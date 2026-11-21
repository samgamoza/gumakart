import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_SUITE_TIERS,
  AI_SUITE_SELLABLE_TIERS,
  creditKindForJob,
  creditsRemaining,
  getAiSuiteTier,
  mediaJobDenial,
  mediaJobPriority,
  resolveAiSuiteTierId,
} from "./ai-suite";
import { normalizePlanId, planAtLeast, PLAN_AI_LIMITS } from "./index";

describe("AI suite tiers — plan spec (IMPLEMENTATION_PLAN Phase 1)", () => {
  it("prices and quotas match the plan", () => {
    const t = AI_SUITE_TIERS;
    assert.deepEqual(
      AI_SUITE_SELLABLE_TIERS.map((x) => [x.id, x.priceMonthlyPhp]),
      [["free", 0], ["starter", 999], ["pro_live", 2999], ["enterprise_vibe", 5999]]
    );
    assert.deepEqual([t.free.photoCreditsLimit, t.starter.photoCreditsLimit, t.pro_live.photoCreditsLimit, t.enterprise_vibe.photoCreditsLimit], [0, 20, 100, -1]);
    assert.deepEqual([t.free.videoCreditsLimit, t.starter.videoCreditsLimit, t.pro_live.videoCreditsLimit, t.enterprise_vibe.videoCreditsLimit], [0, 0, 10, 40]);
    assert.deepEqual([t.enterprise_vibe.queuePriority, t.pro_live.queuePriority, t.starter.queuePriority], [1, 2, 3]);
    assert.equal(t.starter.aiCloserEnabled, false, "Starter gets static auto-reply, not the AI closer");
    assert.equal(t.pro_live.aiCloserEnabled && t.pro_live.broadcastEnabled, true);
    assert.equal(t.pro_live.voiceCloneEnabled, false);
    assert.equal(t.enterprise_vibe.voiceCloneEnabled && t.enterprise_vibe.vibeCodingEnabled, true);
  });

  it("legacy subscribers are grandfathered and never lose AI media access vs Free", () => {
    for (const id of ["growth", "pro"] as const) {
      const tier = AI_SUITE_TIERS[id];
      assert.equal(tier.isGrandfathered, true);
      assert.equal(tier.isLegacy, true);
      assert.ok(tier.photoCreditsLimit >= AI_SUITE_TIERS.free.photoCreditsLimit);
    }
    assert.equal(AI_SUITE_TIERS.growth.priceMonthlyPhp, 499);
    assert.equal(AI_SUITE_TIERS.pro.priceMonthlyPhp, 999);
  });
});

describe("plan id resolution", () => {
  it("maps stored strings to AI-suite tiers", () => {
    assert.equal(resolveAiSuiteTierId("growth"), "growth");
    assert.equal(resolveAiSuiteTierId("pro"), "pro");
    assert.equal(resolveAiSuiteTierId("Advance"), "pro");
    assert.equal(resolveAiSuiteTierId(" PRO_LIVE "), "pro_live");
    assert.equal(resolveAiSuiteTierId("starter"), "starter");
    assert.equal(resolveAiSuiteTierId("sulit"), "free");
    assert.equal(resolveAiSuiteTierId(null), "free");
    assert.equal(resolveAiSuiteTierId("toString"), "free", "prototype keys are not tiers");
    assert.equal(resolveAiSuiteTierId("bogus"), "free");
  });

  it("existing feature gates keep working: legacy ids unchanged, new tiers ≥ their price peers", () => {
    assert.equal(normalizePlanId("growth"), "growth");
    assert.equal(normalizePlanId("pro"), "pro");
    assert.equal(normalizePlanId("starter"), "growth");
    assert.equal(normalizePlanId("pro_live"), "pro");
    assert.equal(normalizePlanId("enterprise_vibe"), "pro");
    for (const tier of Object.values(AI_SUITE_TIERS)) {
      assert.equal(normalizePlanId(tier.id), tier.legacyFeaturePlan, `${tier.id} legacyFeaturePlan`);
    }
    assert.ok(planAtLeast("enterprise_vibe", "pro"));
    assert.ok(planAtLeast("starter", "growth"));
    assert.equal(PLAN_AI_LIMITS[normalizePlanId("pro_live")].label, "Advance");
  });
});

describe("media job rules", () => {
  it("credit kind per job type", () => {
    assert.equal(creditKindForJob("product_photo"), "photo");
    assert.equal(creditKindForJob("video_ad"), "video");
    assert.equal(creditKindForJob("voice_clone"), null);
    assert.equal(creditKindForJob("printair_mockup"), null);
  });

  it("denials follow entitlements", () => {
    assert.equal(mediaJobDenial(getAiSuiteTier("free"), "product_photo"), "photo_not_included");
    assert.equal(mediaJobDenial(getAiSuiteTier("starter"), "product_photo"), null);
    assert.equal(mediaJobDenial(getAiSuiteTier("starter"), "video_ad"), "video_not_included");
    assert.equal(mediaJobDenial(getAiSuiteTier("pro_live"), "video_ad"), null);
    assert.equal(mediaJobDenial(getAiSuiteTier("pro_live"), "voice_clone"), "voice_clone_not_included");
    assert.equal(mediaJobDenial(getAiSuiteTier("enterprise_vibe"), "voice_clone"), null);
    assert.equal(mediaJobDenial(getAiSuiteTier("free"), "printair_mockup"), null, "upsell mockups are free for everyone");
  });

  it("priority and remaining credits", () => {
    assert.equal(mediaJobPriority(1, "product_photo"), 1);
    assert.equal(mediaJobPriority(1, "printair_mockup"), 10);
    assert.equal(creditsRemaining(-1, 999), null);
    assert.equal(creditsRemaining(20, 5), 15);
    assert.equal(creditsRemaining(20, 25), 0);
  });
});
