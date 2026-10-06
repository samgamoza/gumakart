import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkoutDeliveryFee,
  freeDeliveryNudge,
  legacyDeliveryFromShipping,
  normalizeShippingJson,
  resolveShippingFee,
  shippingFromLegacyDelivery,
  phAreaOf,
  cleanAreaRates,
} from "./tenant-shipping";

describe("shippingFromLegacyDelivery", () => {
  it("maps flat rate provider into default profile methods", () => {
    const shipping = shippingFromLegacyDelivery({
      provider: "manual",
      flatRate: 120,
      freeDeliveryMin: 600,
      pickupEnabled: true,
      pickupAddress: "Makati",
    });
    assert.equal(shipping.defaultProfileId, "default");
    assert.ok(shipping.profiles[0]?.methods.some((m) => m.type === "flat"));
    assert.ok(shipping.profiles[0]?.methods.some((m) => m.type === "pickup"));
    const legacy = legacyDeliveryFromShipping(shipping);
    assert.equal(legacy.flatRate, 120);
    assert.equal(legacy.freeDeliveryMin, 600);
    assert.equal(legacy.pickupAddress, "Makati");
  });
});

describe("resolveShippingFee", () => {
  it("applies free shipping threshold", () => {
    const shipping = normalizeShippingJson({
      profiles: [
        {
          id: "default",
          name: "Default",
          methods: [
            {
              id: "flat",
              type: "flat",
              zones: [],
              rates: [{ id: "r1", basis: "flat", amount: 89 }],
              freeAboveSubtotal: 500,
            },
          ],
        },
      ],
    });
    const under = resolveShippingFee({ shipping, subtotal: 400 });
    const over = resolveShippingFee({ shipping, subtotal: 500 });
    assert.equal(under.fee, 89);
    assert.equal(over.fee, 0);
    assert.equal(over.free, true);
  });

  it("matches city zone rates", () => {
    const shipping = normalizeShippingJson({
      profiles: [
        {
          id: "default",
          name: "Default",
          methods: [
            {
              id: "flat",
              type: "flat",
              zones: [
                {
                  id: "ncr",
                  name: "NCR",
                  match: { cities: ["Makati"] },
                },
              ],
              rates: [
                { id: "r-ncr", zoneId: "ncr", basis: "flat", amount: 70 },
                { id: "r-default", basis: "flat", amount: 120 },
              ],
            },
          ],
        },
      ],
    });
    const fee = resolveShippingFee({
      shipping,
      subtotal: 100,
      city: "Makati City",
    });
    assert.equal(fee.fee, 70);
  });
});

describe("Phase 17b: free delivery wins, and the nudge", () => {
  const shipping = shippingFromLegacyDelivery({ flatRate: 80, freeDeliveryMin: 500 });
  it("the resolver reports the method's free minimum", () => {
    assert.equal(resolveShippingFee({ shipping, subtotal: 100 }).freeAbove, 500);
    assert.equal(resolveShippingFee({ shipping: shippingFromLegacyDelivery({ flatRate: 80, freeDeliveryMin: 0 }), subtotal: 100 }).freeAbove, null);
  });
  it("free delivery beats a live courier quote; otherwise the quote wins", () => {
    assert.equal(checkoutDeliveryFee(resolveShippingFee({ shipping, subtotal: 600 }), 145), 0);
    assert.equal(checkoutDeliveryFee(resolveShippingFee({ shipping, subtotal: 300 }), 145), 145);
    assert.equal(checkoutDeliveryFee(resolveShippingFee({ shipping, subtotal: 300 }), null), 80);
  });
  it("nudge: remaining and progress; none without a minimum or an empty cart", () => {
    assert.deepEqual(freeDeliveryNudge(350, 500), { threshold: 500, remaining: 150, progress: 0.7, reached: false });
    assert.equal(freeDeliveryNudge(500, 500)!.reached, true);
    assert.equal(freeDeliveryNudge(650, 500)!.remaining, 0);
    assert.equal(freeDeliveryNudge(100, null), null);
    assert.equal(freeDeliveryNudge(0, 500), null);
  });
});

describe("Phase 24: fee by area", () => {
  it("knows the four areas, with Mindanao checked before Luzon", () => {
    assert.equal(phAreaOf("Metro Manila"), "metro_manila");
    assert.equal(phAreaOf("Cebu"), "visayas");
    assert.equal(phAreaOf("Samar (Western Samar)"), "visayas");
    assert.equal(phAreaOf("Davao del Sur"), "mindanao");
    assert.equal(phAreaOf("City of Isabela"), "mindanao", "not Luzon's Isabela");
    assert.equal(phAreaOf("Isabela"), "luzon");
    assert.equal(phAreaOf("Cavite"), "luzon");
    assert.equal(phAreaOf(""), null);
    assert.deepEqual(cleanAreaRates({ luzon: 150, visayas: -1, mindanao: Number.NaN }), { luzon: 150 });
  });

  it("legacy own-delivery settings charge by area, everyone else the flat rate, free-above still wins", () => {
    const shipping = shippingFromLegacyDelivery({ provider: "manual", flatRate: 99, freeDeliveryMin: 3000, areaRates: { metro_manila: 80, luzon: 150, visayas: 180, mindanao: 200 } });
    const fee = (province: string, subtotal = 500) => resolveShippingFee({ shipping, subtotal, province }).fee;
    assert.equal(fee("Metro Manila"), 80);
    assert.equal(fee("Pampanga"), 150);
    assert.equal(fee("Iloilo"), 180);
    assert.equal(fee("Davao del Sur"), 200);
    assert.equal(fee("City of Isabela"), 200);
    assert.equal(fee("Somewhere else"), 99);
    assert.equal(fee("Cebu", 3500), 0);
    const plain = shippingFromLegacyDelivery({ provider: "manual", flatRate: 99 });
    assert.equal(resolveShippingFee({ shipping: plain, subtotal: 100, province: "Cebu" }).fee, 99, "no areas = flat as before");
  });
});
