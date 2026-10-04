import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTenders, computeSaleTotals, DEFAULT_VAT_RATE, vatConfigFromSettings, type VatConfig } from "./pos-tax";

// Same cases as Veyron tests/test_vat.py: ₱112 inclusive = ₱100 net + ₱12 VAT.
const INCLUSIVE: VatConfig = { rate: 0.12, inclusive: true, registered: true };
const EXCLUSIVE: VatConfig = { rate: 0.12, inclusive: false, registered: true };
const NON_VAT: VatConfig = { rate: 0.12, inclusive: true, registered: false };

describe("VAT inclusive", () => {
  it("extracts VAT from the price", () => {
    const t = computeSaleTotals({ subtotal: 112, config: INCLUSIVE });
    assert.equal(t.netOfVat, 100);
    assert.equal(t.vatAmount, 12);
    assert.equal(t.total, 112);
    assert.equal(t.vatExempt, false);
  });
  it("components reconcile", () => {
    const t = computeSaleTotals({ subtotal: 1234.56, config: INCLUSIVE });
    assert.ok(Math.abs(t.netOfVat + t.vatAmount - t.total) < 0.011);
  });
  it("ordinary discount stays vatable", () => {
    const t = computeSaleTotals({ subtotal: 112, discountRate: 0.1, discountType: "custom", config: INCLUSIVE });
    assert.equal(t.discountAmount, 11.2);
    assert.equal(t.total, 100.8);
    assert.equal(t.netOfVat, 90);
    assert.equal(t.vatAmount, 10.8);
  });
});

describe("VAT exclusive", () => {
  it("adds VAT on top", () => {
    const t = computeSaleTotals({ subtotal: 100, config: EXCLUSIVE });
    assert.equal(t.vatAmount, 12);
    assert.equal(t.total, 112);
  });
});

describe("senior / PWD", () => {
  it("is VAT-exempt and discounts the net amount", () => {
    const t = computeSaleTotals({ subtotal: 112, discountRate: 0.2, discountType: "senior", config: INCLUSIVE });
    assert.equal(t.vatExempt, true);
    assert.equal(t.vatAmount, 0);
    assert.equal(t.discountAmount, 20);
    assert.equal(t.total, 80);
    assert.equal(t.vatExemptSales, 80);
  });
  it("PWD matches senior", () => {
    const s = computeSaleTotals({ subtotal: 112, discountRate: 0.2, discountType: "senior", config: INCLUSIVE });
    const p = computeSaleTotals({ subtotal: 112, discountRate: 0.2, discountType: "pwd", config: INCLUSIVE });
    assert.equal(s.total, p.total);
  });
  it("is not the naive 20% off the VAT-inclusive price", () => {
    const t = computeSaleTotals({ subtotal: 112, discountRate: 0.2, discountType: "senior", config: INCLUSIVE });
    assert.notEqual(t.total, 89.6);
  });
  it("non-VAT seller: 20% off the price as-is", () => {
    const t = computeSaleTotals({ subtotal: 112, discountRate: 0.2, discountType: "senior", config: NON_VAT });
    assert.equal(t.total, 89.6);
    assert.equal(t.vatAmount, 0);
  });
});

describe("non-VAT registered", () => {
  it("charges no VAT", () => {
    const t = computeSaleTotals({ subtotal: 112, config: NON_VAT });
    assert.equal(t.vatExempt, true);
    assert.equal(t.vatAmount, 0);
    assert.equal(t.total, 112);
  });
});

describe("config parsing", () => {
  it("defaults", () => {
    const c = vatConfigFromSettings({});
    assert.equal(c.rate, DEFAULT_VAT_RATE);
    assert.equal(c.inclusive, true);
    assert.equal(c.registered, false);
  });
  it("12 means 12%", () => assert.equal(vatConfigFromSettings({ vatRate: "12" }).rate, 0.12));
  it("garbage falls back", () => assert.equal(vatConfigFromSettings({ vatRate: "abc" }).rate, DEFAULT_VAT_RATE));
  it("flags parse", () => {
    const c = vatConfigFromSettings({ vatInclusive: "0", vatRegistered: true });
    assert.equal(c.inclusive, false);
    assert.equal(c.registered, true);
  });
  it("zero rate is safe", () => {
    const t = computeSaleTotals({ subtotal: 100, config: { rate: 0, inclusive: true, registered: true } });
    assert.equal(t.vatAmount, 0);
    assert.equal(t.total, 100);
  });
});

describe("tenders", () => {
  it("cash change", () => {
    const r = checkTenders(80, [{ method: "cash", amount: 100 }]);
    assert.deepEqual(r.ok && [r.change, r.paidByMethod.cash], [20, 80]);
  });
  it("split cash + GCash", () => {
    const r = checkTenders(500, [{ method: "gcash", amount: 300 }, { method: "cash", amount: 250 }]);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.change, 50);
      assert.equal(r.paidByMethod.cash, 200);
      assert.equal(r.paidByMethod.gcash, 300);
    }
  });
  it("short", () => assert.equal(checkTenders(100, [{ method: "cash", amount: 50 }]).ok, false));
  it("GCash over the total is refused", () => assert.equal(checkTenders(100, [{ method: "gcash", amount: 150 }]).ok, false));
  it("max two, no repeats", () => {
    assert.equal(checkTenders(100, [{ method: "cash", amount: 50 }, { method: "cash", amount: 50 }]).ok, false);
    assert.equal(
      checkTenders(100, [{ method: "cash", amount: 30 }, { method: "gcash", amount: 30 }, { method: "maya", amount: 40 }]).ok,
      false
    );
  });
});
