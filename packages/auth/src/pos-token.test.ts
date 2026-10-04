import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPosDeviceToken,
  createPosStaffToken,
  validatePosPin,
  verifyPosDeviceToken,
  verifyPosStaffToken,
} from "./pos-token";
import { createSessionToken, verifySessionToken } from "./session";

process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";

test("device and staff tokens round-trip and can't be swapped", async () => {
  const device = await createPosDeviceToken({ tenantId: "t1" });
  const staff = await createPosStaffToken({ tenantId: "t1", staffId: "s1", pinVersion: 3 });
  assert.deepEqual(await verifyPosDeviceToken(device), { tenantId: "t1" });
  assert.deepEqual(await verifyPosStaffToken(staff), { tenantId: "t1", staffId: "s1", pinVersion: 3 });
  assert.equal(await verifyPosStaffToken(device), null);
  assert.equal(await verifyPosDeviceToken(staff), null);
  assert.equal(await verifyPosStaffToken(`${staff}x`), null);
});

test("a POS token is never a seller session, and a session is never a POS token", async () => {
  const staff = await createPosStaffToken({ tenantId: "t1", staffId: "s1", pinVersion: 1 });
  assert.equal(await verifySessionToken(staff), null);
  const session = await createSessionToken({
    userId: "u1",
    email: "a@b.c",
    role: "seller_owner",
    tenantId: "t1",
    tenantSlug: "s",
    tenantName: "S",
    displayName: "A",
    emailVerified: true,
    needsShopSetup: false,
    sessionVersion: 1,
  } as Parameters<typeof createSessionToken>[0]);
  assert.equal(await verifyPosStaffToken(session), null);
  assert.equal(await verifyPosDeviceToken(session), null);
});

test("PIN rules", () => {
  assert.equal(validatePosPin("4821").ok, true);
  assert.equal(validatePosPin("482193").ok, true);
  assert.equal(validatePosPin("123").ok, false);
  assert.equal(validatePosPin("1111").ok, false);
  assert.equal(validatePosPin("1234").ok, false);
  assert.equal(validatePosPin("4321").ok, false);
  assert.equal(validatePosPin("12a4").ok, false);
});
