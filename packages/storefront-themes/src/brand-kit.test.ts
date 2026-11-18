import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRAND_KIT_COMBINATIONS, brandCopyGroupOf, deriveBrandKit } from "./brand-kit";
import { SHOP_BUSINESS_CATEGORIES } from "./shop-categories";
import { recommendTemplates } from "./recommend-templates";
import { buildStoreDNA } from "./store-dna";
import { STORE_LOOK_COMBINATIONS } from "./store-look";

describe("deriveBrandKit uniqueness", () => {
  it("gives different cake shops different palettes or looks", () => {
    const a = deriveBrandKit({
      shopName: "Halo Queen Cakes",
      slug: "halo-queen-cakes",
      category: "Food & Beverage",
      vibe: "cute",
    });
    const b = deriveBrandKit({
      shopName: "Buddy Bake House",
      slug: "buddy-bake-house",
      category: "Food & Beverage",
      vibe: "cute",
    });

    const sameSurface =
      a.paletteId === b.paletteId &&
      a.primaryColor === b.primaryColor &&
      a.tagline === b.tagline &&
      a.promoTitle === b.promoTitle &&
      JSON.stringify(a.storeLook) === JSON.stringify(b.storeLook) &&
      a.displayFont === b.displayFont;

    assert.equal(sameSurface, false);
    assert.ok(a.storeLook);
    assert.ok(b.storeLook);
  });

  it("is stable for the same slug + name", () => {
    const once = deriveBrandKit({
      shopName: "Hungry Buddy",
      slug: "hungry-buddy",
      category: "Food & Beverage",
    });
    const twice = deriveBrandKit({
      shopName: "Hungry Buddy",
      slug: "hungry-buddy",
      category: "Food & Beverage",
    });
    assert.deepEqual(once, twice);
  });

  it("reports a large free-plan combination space", () => {
    assert.ok(STORE_LOOK_COMBINATIONS >= 72);
    assert.ok(BRAND_KIT_COMBINATIONS.free > 50_000);
  });
});

describe("starter copy matches the category", () => {
  it("puts each kind of business in the right copy group", () => {
    assert.equal(brandCopyGroupOf("Insurance & Financial Services"), "financial");
    assert.equal(brandCopyGroupOf("Professional & Consulting"), "professional");
    assert.equal(brandCopyGroupOf("Healthcare & Clinics"), "professional");
    assert.equal(brandCopyGroupOf("Real Estate & Property"), "professional");
    assert.equal(brandCopyGroupOf("HVAC & Air Conditioning"), "service");
    assert.equal(brandCopyGroupOf("Home Services & Trades"), "service");
    assert.equal(brandCopyGroupOf("Barber & Hair Salons"), "service");
    assert.equal(brandCopyGroupOf("Food & Beverage"), "retail");
    assert.equal(brandCopyGroupOf("Catering"), "retail");
    assert.equal(brandCopyGroupOf("Fashion & Apparel"), "retail");
  });

  it("never gives insurance copy to a shop that isn't insurance or finance", () => {
    for (const category of SHOP_BUSINESS_CATEGORIES) {
      if (/insurance|financ/i.test(category)) continue;
      for (const shopName of ["SGG IT Services", "Aling Nena", "Bright Path", "Juan Repairs", "Kape Co"]) {
        const kit = deriveBrandKit({ shopName, slug: shopName.toLowerCase().replace(/\W+/g, "-"), category });
        const text = `${kit.promoTitle} ${kit.promoSubtitle} ${kit.tagline}`;
        assert.doesNotMatch(text, /protection|retirement|protect what matters|every stage of life/i, `${category} / ${shopName}: ${text}`);
      }
    }
  });

  it("never promises delivery deals to service or professional shops", () => {
    for (const category of ["Professional & Consulting", "HVAC & Air Conditioning", "Healthcare & Clinics", "Cleaning & Janitorial"]) {
      for (const shopName of ["SGG IT Services", "Cool Air PH", "Bright Path", "Linis Pro", "Juan Fix"]) {
        const kit = deriveBrandKit({ shopName, slug: shopName.toLowerCase().replace(/\W+/g, "-"), category });
        assert.doesNotMatch(`${kit.promoTitle} ${kit.promoSubtitle}`, /delivery|₱|% off|freebie/i, `${category}: ${kit.promoTitle}`);
      }
    }
  });
});

describe("recommendTemplates diversity", () => {
  it("spreads food Top-1 across different shop names", () => {
    const names = [
      "Sarab Kitchen",
      "Mango Mart Eats",
      "Fruitables Cafe",
      "Blush Bakery PH",
      "Simply Sweet Manila",
      "Organic Bowl Co",
    ];
    const tops = new Set(
      names.map((businessName) => {
        const dna = buildStoreDNA({
          businessName,
          category: "Food & Beverage",
          vibe: "bold",
        });
        return recommendTemplates(dna, { plan: "free", limit: 3 })[0]?.id;
      })
    );
    assert.ok(tops.size >= 2, `expected ≥2 distinct Top-1 templates, got ${[...tops]}`);
  });

  it("soft-penalizes occupied templates", () => {
    const dna = buildStoreDNA({
      businessName: "Neighborhood Eats",
      category: "Food & Beverage",
      vibe: "bold",
    });
    const baseline = recommendTemplates(dna, { plan: "free", limit: 3 });
    const topId = baseline[0]?.id;
    assert.ok(topId);

    const avoided = recommendTemplates(dna, {
      plan: "free",
      limit: 3,
      avoidTemplateIds: [topId],
    });
    // Occupied #1 should not stay #1 when a close competitor exists.
    assert.notEqual(avoided[0]?.id, topId);
  });

  it("boosts bakery names toward sweet templates", () => {
    const dna = buildStoreDNA({
      businessName: "Choco Cake Bakery",
      category: "Food & Beverage",
      vibe: "cute",
    });
    const top3 = recommendTemplates(dna, { plan: "free", limit: 3 }).map((t) => t.id);
    const sweetHit = top3.some((id) =>
      ["simply-sweet", "blush-bakery", "fruitables", "foodmart", "sarab"].includes(id)
    );
    assert.ok(sweetHit);
    // Prefer sweet patterns in the top slot when name says bakery/cake.
    assert.ok(
      ["simply-sweet", "blush-bakery", "fruitables", "foodmart"].includes(top3[0]!) ||
        top3.includes("simply-sweet") ||
        top3.includes("blush-bakery")
    );
  });
});
