import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhPhone, isValidPhMobile, normalizePhMobile, paymentMethodLabel, telHref } from "./format-ph";

test("normalizes the common ways sellers type a PH mobile", () => {
  assert.equal(normalizePhMobile("09171234567"), "09171234567");
  assert.equal(normalizePhMobile("+63 917 123 4567"), "09171234567");
  assert.equal(normalizePhMobile("639171234567"), "09171234567");
  assert.equal(normalizePhMobile("917-123-4567"), "09171234567");
  assert.equal(normalizePhMobile("0917123456"), null);
  assert.equal(normalizePhMobile("(02) 8123 4567"), null);
});

test("formats for display and leaves foreign numbers alone", () => {
  assert.equal(formatPhPhone("+639281112222"), "0928 111 2222");
  assert.equal(formatPhPhone("+1 415 555 0100"), "+1 415 555 0100");
  assert.equal(formatPhPhone(null), "");
  assert.equal(isValidPhMobile("0917 123 4567"), true);
  assert.equal(telHref("09171234567"), "tel:+639171234567");
});

test("payment labels read like a buyer would say them", () => {
  assert.equal(paymentMethodLabel("paymaya"), "Maya");
  assert.equal(paymentMethodLabel("COD"), "Cash on delivery");
  assert.equal(paymentMethodLabel("bank_transfer"), "Bank Transfer");
});
