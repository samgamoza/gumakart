import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE128_PATTERNS, code128Modules, code128Values, ean13CheckDigit } from "./code128";

test("pattern table: every symbol is 11 modules, stop is 13, 3 bars + 3 spaces", () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, i) => {
    const sum = [...p].reduce((a, d) => a + Number(d), 0);
    assert.equal(sum, i === 106 ? 13 : 11, `symbol ${i}`);
  });
  assert.equal(new Set(CODE128_PATTERNS).size, 107, "all distinct");
});

test("code set B and C with checksum", () => {
  // "PJJ123C" — the classic Wikipedia example: start B, data, checksum 54, stop.
  assert.deepEqual(code128Values("PJJ123C"), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  // all digits, even length → code set C pairs
  assert.deepEqual(code128Values("123456").slice(0, 4), [105, 12, 34, 56]);
  // odd-length digits: set C pairs, then switch to B for the last digit
  assert.deepEqual(code128Values("12345").slice(0, 5), [105, 12, 34, 100, 21]);
  assert.throws(() => code128Values("ñ"));
  const m = code128Modules("ABC");
  assert.equal(m[0], 10);
  assert.equal(m.at(-1), 10);
});

test("EAN-13 check digit", () => {
  assert.equal(ean13CheckDigit("400638133393"), 1); // 4006381333931
  assert.equal(ean13CheckDigit("200000000001"), 5);
});
