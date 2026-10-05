import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeCheckoutTotals,
  isPaymentMethodEnabled,
  normalizeCheckoutJson,
} from "./tenant-checkout";

describe("normalizeCheckoutJson", () => {
  it("defaults payment adapters and abandoned window", () => {
    const normalized = normalizeCheckoutJson({});
    assert.equal(normalized.codEnabled, true);
    assert.equal(normalized.abandonedAfterMinutes, 60);
    assert.equal(normalized.paymentAdapters?.manual_ewallet?.gcash, true);
    assert.equal(normalized.paymentAdapters?.paymongo?.gcash, false);
    assert.equal(normalized.paymentAdapters?.paymongo?.card, false);
  });
});

describe("computeCheckoutTotals", () => {
  it("applies percent coupon, exclusive tax, and delivery", () => {
    const totals = computeCheckoutTotals({
      subtotal: 1000,
      deliveryFee: 50,
      couponCode: "SAVE10",
      checkout: normalizeCheckoutJson({
        tax: { enabled: true, ratePercent: 12, inclusive: false },
        coupons: [{ code: "SAVE10", type: "percent", value: 10, active: true }],
      }),
    });
    assert.equal(totals.discount, 100);
    assert.equal(totals.tax, 108); // 12% of 900
    assert.equal(totals.total, 1058); // 900 + 108 + 50
    assert.equal(totals.couponCode, "SAVE10");
  });

  it("caps discount at subtotal", () => {
    const totals = computeCheckoutTotals({
      subtotal: 100,
      deliveryFee: 0,
      couponCode: "BIG",
      checkout: normalizeCheckoutJson({
        coupons: [{ code: "BIG", type: "fixed", value: 500, active: true }],
      }),
    });
    assert.equal(totals.discount, 100);
    assert.equal(totals.total, 0);
  });
});

describe("isPaymentMethodEnabled", () => {
  it("respects adapter toggles", () => {
    const checkout = normalizeCheckoutJson({
      codEnabled: true,
      paymentAdapters: {
        cod: true,
        manual_ewallet: { gcash: false, maya: false, bank: false },
        paymongo: { gcash: true, paymaya: false, qrph: true, card: true },
      },
    });
    assert.equal(isPaymentMethodEnabled(checkout, "gcash"), true);
    assert.equal(isPaymentMethodEnabled(checkout, "paymaya"), false);
    assert.equal(isPaymentMethodEnabled(checkout, "card"), true);
    assert.equal(isPaymentMethodEnabled(checkout, "cod"), true);
  });
});

describe("Phase 14 discounts", () => {
  const lines = [
    { productId: "shirt", quantity: 3, lineTotal: 600 },
    { productId: "cap", quantity: 1, lineTotal: 150 },
  ];
  it("quantity deals apply to matching items only, best deal per line", () => {
    const checkout = normalizeCheckoutJson({
      volumeDiscounts: [
        { label: "3+ shirts 10% off", productIds: ["shirt"], minQty: 3, type: "percent", value: 10 },
        { label: "Any 4 items ₱20 off each", productIds: [], minQty: 4, type: "fixed", value: 20 },
      ],
    });
    const t = computeCheckoutTotals({ subtotal: 750, deliveryFee: 0, checkout, lines });
    // shirts: max(60, 3×20=60) = 60; cap: 20 → 80 off
    assert.equal(t.discount, 80);
    assert.equal(t.total, 670);
    assert.match(t.discountLabel ?? "", /off/);
    const fewer = computeCheckoutTotals({ subtotal: 400, deliveryFee: 0, checkout, lines: [{ productId: "shirt", quantity: 2, lineTotal: 400 }] });
    assert.equal(fewer.discount, 0, "below the minimum quantity");
  });

  it("coupon applies after the deal; schedule windows are respected", () => {
    const checkout = normalizeCheckoutJson({
      volumeDiscounts: [{ label: "3+ shirts", productIds: ["shirt"], minQty: 3, type: "percent", value: 10 }],
      coupons: [
        { code: "PAYDAY", type: "percent", value: 10, startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-10-16T00:00:00Z" },
      ],
    });
    const during = computeCheckoutTotals({ subtotal: 750, deliveryFee: 0, checkout, lines, couponCode: "payday", now: new Date("2026-10-15T05:00:00Z") });
    // 60 off shirts → 690 → 10% = 69 → 129
    assert.equal(during.discount, 129);
    assert.equal(during.couponCode, "PAYDAY");
    const before = computeCheckoutTotals({ subtotal: 750, deliveryFee: 0, checkout, lines, couponCode: "PAYDAY", now: new Date("2026-10-14T05:00:00Z") });
    assert.equal(before.couponCode, null);
    assert.equal(before.discount, 60);
  });

  it("drops invalid deals", () => {
    const c = normalizeCheckoutJson({ volumeDiscounts: [{ minQty: 1, value: 10 }, { minQty: 2, type: "percent", value: 150 }, { minQty: 2, value: 5, type: "fixed" }] });
    assert.equal(c.volumeDiscounts?.length, 1);
  });
});
