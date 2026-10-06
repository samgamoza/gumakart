import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  looksLikeBackupCode,
  matchTotp,
  openTotpSecret,
  otpauthUri,
  sealTotpSecret,
  totpCodeAt,
  totpStep,
} from "./totp";

process.env.AUTH_SECRET ??= "test-only-auth-secret-for-totp-unit-tests-xx";

// RFC 6238 appendix B (SHA-1 seed "12345678901234567890"); the RFC prints 8 digits, we use the last 6.
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));
const RFC = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
] as const;

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", async () => {
    for (const [t, code] of RFC) assert.equal(await totpCodeAt(RFC_SECRET, totpStep(t * 1000)), code, `T=${t}`);
  });

  it("base32 round-trips and ignores spaces/case", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    const s = base32Encode(bytes);
    assert.deepEqual([...base32Decode(s.toLowerCase().replace(/(.{4})/g, "$1 "))], [...bytes]);
    assert.equal(generateTotpSecret().length, 32);
  });

  it("accepts the neighbouring steps, not further ones", async () => {
    const secret = generateTotpSecret();
    const now = 1_790_000_000_000;
    const step = totpStep(now);
    for (const d of [-1, 0, 1]) assert.equal(await matchTotp(secret, await totpCodeAt(secret, step + d), { nowMs: now }), step + d);
    for (const d of [-3, -2, 2]) assert.equal(await matchTotp(secret, await totpCodeAt(secret, step + d), { nowMs: now }), null);
  });

  it("refuses a step at or before the last one used (replay)", async () => {
    const secret = generateTotpSecret();
    const now = 1_790_000_000_000;
    const step = totpStep(now);
    const code = await totpCodeAt(secret, step);
    assert.equal(await matchTotp(secret, code, { nowMs: now, lastStep: step }), null);
    assert.equal(await matchTotp(secret, code, { nowMs: now, lastStep: step - 1 }), step);
  });

  it("takes codes typed with spaces or dashes, rejects junk", async () => {
    const secret = generateTotpSecret();
    const now = 1_790_000_000_000;
    const code = await totpCodeAt(secret, totpStep(now));
    assert.ok(await matchTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }));
    assert.equal(await matchTotp(secret, "12345", { nowMs: now }), null);
    assert.equal(await matchTotp(secret, "abcdef", { nowMs: now }), null);
  });

  it("builds an otpauth link the apps understand", () => {
    const uri = otpauthUri({ secret: "ABC", account: "ops@guma.one", issuer: "Guma Kart Ops" });
    assert.ok(uri.startsWith("otpauth://totp/Guma%20Kart%20Ops%3Aops%40guma.one?"));
    assert.match(uri, /secret=ABC/);
    assert.match(uri, /period=30/);
  });
});

describe("backup codes and sealing", () => {
  it("makes 10 distinct readable codes", () => {
    const codes = generateBackupCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) {
      assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
      assert.ok(looksLikeBackupCode(c));
    }
    assert.equal(looksLikeBackupCode("123456"), false);
  });

  it("hashes the same however it's typed", async () => {
    assert.equal(await hashBackupCode("k7dm-2xqp"), await hashBackupCode(" K7DM2XQP "));
    assert.notEqual(await hashBackupCode("k7dm-2xqp"), await hashBackupCode("k7dm-2xqq"));
  });

  it("seals and opens the secret; the sealed form doesn't contain it", async () => {
    const secret = generateTotpSecret();
    const sealed = await sealTotpSecret(secret);
    assert.ok(!sealed.includes(secret));
    assert.notEqual(sealed, await sealTotpSecret(secret), "random IV each time");
    assert.equal(await openTotpSecret(sealed), secret);
    const [v, iv, ct] = sealed.split(".");
    const tampered = `${v}.${iv}.${ct!.slice(0, -4)}AAA=`;
    await assert.rejects(openTotpSecret(tampered));
  });
});
