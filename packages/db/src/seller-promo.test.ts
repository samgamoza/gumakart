/** Phase 17 — pure rules: store promos at the POS, senior/PWD vs promo, gift card codes (no DB). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePosSaleTotals } from "./types/pos-tax";
import { computeStorePromotion } from "./types/tenant-checkout";
import { newGiftCardCode, normalizeGiftCardCode } from "./queries/gift-cards";

const now = new Date("2026-10-06T04:00:00Z");

describe("store promotion (no coupons)", () => {
  const checkout = {
    volumeDiscounts: [{ id: "v1", label: "3+ soap 10% off", productIds: ["soap"], minQty: 3, type: "percent" as const, value: 10 }],
    automaticDiscount: { type: "fixed" as const, value: 50, minSubtotal: 500, label: "₱50 off ₱500+" },
  };
  it("nothing when no rule matches", () => {
    assert.deepEqual(computeStorePromotion(checkout, [{ productId: "soap", quantity: 1, lineTotal: 100 }], now), { amount: 0, labels: [] });
  });
  it("quantity deal applies to its product", () => {
    const r = computeStorePromotion(checkout, [{ productId: "soap", quantity: 3, lineTotal: 300 }], now);
    assert.equal(r.amount, 30);
    assert.equal(r.labels.length, 1);
  });
  it("automatic discount stacks on top of a deal once the minimum is met", () => {
    const r = computeStorePromotion(
      checkout,
      [
        { productId: "soap", quantity: 3, lineTotal: 300 },
        { productId: "shirt", quantity: 2, lineTotal: 400 },
      ],
      now
    );
    assert.equal(r.amount, 80);
    assert.equal(r.labels.length, 2);
  });
  it("expired windows are ignored", () => {
    const r = computeStorePromotion(
      { volumeDiscounts: [], automaticDiscount: { type: "percent", value: 10, endsAt: "2026-01-01T00:00:00Z" } },
      [{ productId: "x", quantity: 1, lineTotal: 1000 }],
      now
    );
    assert.equal(r.amount, 0);
  });
});

describe("POS totals with a promo", () => {
  it("no promo, no discount = plain totals", () => {
    const t = computePosSaleTotals({ subtotal: 1000 });
    assert.equal(t.total, 1000);
    assert.equal(t.promoAmount, 0);
  });
  it("promo comes off before VAT", () => {
    const t = computePosSaleTotals({ subtotal: 1000, promo: { amount: 100, labels: ["Deal"] } });
    assert.equal(t.total, 900);
    assert.equal(t.promoAmount, 100);
    assert.equal(t.promoLabel, "Deal");
    assert.equal(t.subtotal, 1000);
  });
  it("promo is capped at the subtotal", () => {
    const t = computePosSaleTotals({ subtotal: 50, promo: { amount: 80, labels: ["Big"] } });
    assert.equal(t.total, 0);
    assert.equal(t.promoAmount, 50);
  });
  it("senior/PWD: the 20% wins over a small promo — never both", () => {
    const t = computePosSaleTotals({ subtotal: 1120, discountType: "senior", promo: { amount: 50, labels: ["Small"] } });
    assert.equal(t.promoAmount, 0);
    assert.ok(t.discountAmount > 0);
    assert.equal(t.total, computePosSaleTotals({ subtotal: 1120, discountType: "senior" }).total);
  });
  it("senior/PWD: a bigger promo wins instead", () => {
    const t = computePosSaleTotals({ subtotal: 1120, discountType: "pwd", promo: { amount: 600, labels: ["Half off"] } });
    assert.equal(t.promoAmount, 600);
    assert.equal(t.discountAmount, 0);
    assert.equal(t.total, 520);
  });
});

describe("gift card codes", () => {
  it("format and normalisation", () => {
    const code = newGiftCardCode();
    assert.match(code, /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(normalizeGiftCardCode(code.toLowerCase().replace(/-/g, " ")), code);
    assert.equal(normalizeGiftCardCode("nope"), null);
    assert.equal(normalizeGiftCardCode(""), null);
  });
});
