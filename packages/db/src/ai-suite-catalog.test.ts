import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { AI_SUITE_TIERS } from "@gumakart/plans";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(path.join(here, "../drizzle/0047_ai_marketing_suite.sql"), "utf8");

/** Parse the seed rows of `INSERT INTO "subscription_tiers" ... VALUES (...)`. */
function seededTiers(): Map<string, string[]> {
  const block = migration.split(`INSERT INTO "subscription_tiers"`)[1]!.split("ON CONFLICT")[0]!;
  const rows = new Map<string, string[]>();
  for (const m of block.matchAll(/\(\s*'([a-z_]+)',\s*'([^']+)',([^)]*)\)/g)) {
    rows.set(m[1]!, [m[2]!, ...m[3]!.split(",").map((v) => v.trim()).filter(Boolean)]);
  }
  return rows;
}

describe("subscription_tiers seed (0047) mirrors @gumakart/plans AI_SUITE_TIERS", () => {
  it("has exactly the same tiers and values", () => {
    const rows = seededTiers();
    assert.deepEqual([...rows.keys()].sort(), Object.keys(AI_SUITE_TIERS).sort());
    for (const tier of Object.values(AI_SUITE_TIERS)) {
      const [name, price, isLegacy, grandfathered, legacyPlan, photo, video, closer, broadcast, voice, vibe, prio, sort] = rows.get(tier.id)!;
      assert.deepEqual(
        { name, price: Number(price), isLegacy, grandfathered, legacyPlan, photo: Number(photo), video: Number(video), closer, broadcast, voice, vibe, prio: Number(prio), sort: Number(sort) },
        {
          name: tier.displayName,
          price: tier.priceMonthlyPhp,
          isLegacy: String(tier.isLegacy),
          grandfathered: String(tier.isGrandfathered),
          legacyPlan: `'${tier.legacyFeaturePlan}'`,
          photo: tier.photoCreditsLimit,
          video: tier.videoCreditsLimit,
          closer: String(tier.aiCloserEnabled),
          broadcast: String(tier.broadcastEnabled),
          voice: String(tier.voiceCloneEnabled),
          vibe: String(tier.vibeCodingEnabled),
          prio: tier.queuePriority,
          sort: tier.sortOrder,
        },
        `tier ${tier.id}`
      );
    }
  });
});
