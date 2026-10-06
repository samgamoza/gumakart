/**
 * Phase 21 — two-step sign-in (local Postgres only): enrollment, replay protection, single-use
 * backup codes, the 2FA ticket, and that a ticket is never accepted as a session.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb, tenants, users } from "@gumakart/db";
import { hashPassword } from "./password";
import { changePassword, revokeAllSessions, signOutOtherDevices, isSessionCurrent } from "./service";
import { verifySessionToken } from "./session";
import { totpCodeAt, totpStep } from "./totp";
import {
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  createMfaTicket,
  disableTwoFactor,
  getTwoFactorStatus,
  hasTwoFactor,
  readMfaTicket,
  regenerateBackupCodes,
  ticketUserIsCurrent,
  verifySecondFactor,
} from "./two-factor";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");
process.env.AUTH_SECRET ??= "test-only-two-factor-secret-0123456789abcd";

const db = getDb();
const run = randomUUID().slice(0, 8);
const owner = { email: `2fa-owner-${run}@example.com`, id: "" };
const ops = { email: `2fa-ops-${run}@example.com`, id: "" };
let tenantId = "";
let secret = "";
let backupCodes: string[] = [];

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-2fa-${run}`, name: "2FA Shop", status: "active" }).returning();
  tenantId = t!.id;
  const hash = await hashPassword("OldPassword1");
  const rows = await db
    .insert(users)
    .values([
      { email: owner.email, passwordHash: hash, role: "seller_owner", tenantId, emailVerifiedAt: new Date() },
      { email: ops.email, passwordHash: hash, role: "super_admin" },
    ])
    .returning({ id: users.id, email: users.email });
  for (const r of rows) for (const o of [owner, ops]) if (o.email === r.email) o.id = r.id;
});

after(async () => {
  await db.delete(users).where(inArray(users.id, [owner.id, ops.id]));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

const codeAt = (offset: number) => totpCodeAt(secret, totpStep() + offset);

describe("enrollment", () => {
  it("starts off; a started-but-unconfirmed setup doesn't count as on", async () => {
    assert.equal(await hasTwoFactor(owner.id), false);
    ({ secret } = await beginTwoFactorEnrollment(owner.id, "Guma Kart"));
    assert.equal(await hasTwoFactor(owner.id), false);
    const [row] = await db.select({ sealed: users.totpSecretSealed }).from(users).where(eq(users.id, owner.id));
    assert.ok(row!.sealed && !row!.sealed.includes(secret), "secret is stored sealed");
  });

  it("a wrong code doesn't turn it on", async () => {
    await assert.rejects(confirmTwoFactorEnrollment(owner.id, "000000"), /didn't match/);
    assert.equal(await hasTwoFactor(owner.id), false);
  });

  it("the app's current code turns it on and returns 10 backup codes", async () => {
    ({ backupCodes } = await confirmTwoFactorEnrollment(owner.id, await codeAt(0)));
    assert.equal(backupCodes.length, 10);
    const status = await getTwoFactorStatus(owner.id);
    assert.equal(status.enabled, true);
    assert.equal(status.backupCodesLeft, 10);
    const [row] = await db.select({ codes: users.totpBackupCodes }).from(users).where(eq(users.id, owner.id));
    assert.ok(!row!.codes.includes(backupCodes[0]!), "only hashes are stored");
  });

  it("can't restart enrollment while on (a stolen session can't swap the phone)", async () => {
    await assert.rejects(beginTwoFactorEnrollment(owner.id, "Guma Kart"), /already on/);
  });
});

describe("sign-in codes", () => {
  it("the code used to turn it on can't be used again (replay)", async () => {
    await assert.rejects(verifySecondFactor(owner.id, await codeAt(0)), /already used|didn't work/);
  });

  it("the next code works once", async () => {
    const next = await codeAt(1);
    assert.equal((await verifySecondFactor(owner.id, next)).method, "totp");
    await assert.rejects(verifySecondFactor(owner.id, next));
  });

  it("two requests racing with the same fresh backup code: exactly one wins", async () => {
    const code = backupCodes[0]!;
    const results = await Promise.allSettled([verifySecondFactor(owner.id, code), verifySecondFactor(owner.id, code)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(verifySecondFactor(owner.id, code), /didn't work/);
    assert.equal((await getTwoFactorStatus(owner.id)).backupCodesLeft, 9);
  });

  it("backup codes work however they're typed", async () => {
    const r = await verifySecondFactor(owner.id, backupCodes[1]!.toUpperCase().replace("-", " "));
    assert.equal(r.method, "backup");
    assert.equal(r.backupCodesLeft, 8);
  });

  it("new backup codes need a current code and replace the old ones", async () => {
    await assert.rejects(regenerateBackupCodes(owner.id, "123456"));
    const { backupCodes: fresh } = await regenerateBackupCodes(owner.id, backupCodes[2]!);
    assert.equal((await getTwoFactorStatus(owner.id)).backupCodesLeft, 10);
    await assert.rejects(verifySecondFactor(owner.id, backupCodes[3]!), /didn't work/);
    backupCodes = fresh;
  });
});

describe("2FA ticket", () => {
  it("is tied to the app and is never a session", async () => {
    const ticket = await createMfaTicket({ userId: owner.id, sessionVersion: 0, app: "admin", kind: "verify", next: "/orders" });
    assert.equal((await readMfaTicket(ticket, "admin"))?.next, "/orders");
    assert.equal(await readMfaTicket(ticket, "ops"), null, "an admin ticket can't be used on ops");
    assert.equal(await verifySessionToken(ticket), null, "a ticket is not a session");
  });

  it("drops off-site destinations", async () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil"]) {
      const t = await createMfaTicket({ userId: owner.id, sessionVersion: 0, app: "admin", kind: "verify", next: bad });
      assert.equal((await readMfaTicket(t, "admin"))?.next, null, bad);
    }
  });

  it("dies when the account signs out everywhere", async () => {
    const t = (await readMfaTicket(await createMfaTicket({ userId: owner.id, sessionVersion: 0, app: "admin", kind: "verify" }), "admin"))!;
    assert.equal(await ticketUserIsCurrent(t), true);
    await revokeAllSessions(owner.id);
    assert.equal(await ticketUserIsCurrent(t), false);
  });

  it("an ops ticket only works for a super-admin", async () => {
    const opsTicket = (await readMfaTicket(await createMfaTicket({ userId: ops.id, sessionVersion: 0, app: "ops", kind: "enroll" }), "ops"))!;
    assert.equal(await ticketUserIsCurrent(opsTicket), true);
    const sellerOnOps = (await readMfaTicket(await createMfaTicket({ userId: owner.id, sessionVersion: 1, app: "ops", kind: "verify" }), "ops"))!;
    assert.equal(await ticketUserIsCurrent(sellerOnOps), false);
  });
});

describe("turning it off, password change, other devices", () => {
  it("turning off needs a valid code", async () => {
    await assert.rejects(disableTwoFactor(owner.id, "999999"));
    assert.equal(await hasTwoFactor(owner.id), true);
    await disableTwoFactor(owner.id, backupCodes[0]!);
    assert.equal(await hasTwoFactor(owner.id), false);
    assert.equal((await getTwoFactorStatus(owner.id)).backupCodesLeft, 0);
  });

  it("change password: needs the current one, rejects weak, signs out other sessions", async () => {
    await assert.rejects(changePassword({ userId: owner.id, currentPassword: "nope", newPassword: "NewPassword22" }), /current password is wrong/);
    await assert.rejects(changePassword({ userId: owner.id, currentPassword: "OldPassword1", newPassword: "short" }));
    const [before] = await db.select({ sv: users.sessionVersion }).from(users).where(eq(users.id, owner.id));
    const fresh = await changePassword({ userId: owner.id, currentPassword: "OldPassword1", newPassword: "NewPassword22" });
    assert.equal(await isSessionCurrent(owner.id, before!.sv), false);
    assert.equal(await isSessionCurrent(owner.id, fresh.user.sessionVersion), true);
  });

  it("sign out other devices keeps this one", async () => {
    const [before] = await db.select({ sv: users.sessionVersion }).from(users).where(eq(users.id, owner.id));
    const fresh = await signOutOtherDevices(owner.id);
    assert.equal(await isSessionCurrent(owner.id, before!.sv), false);
    assert.equal(await isSessionCurrent(owner.id, fresh!.user.sessionVersion), true);
  });
});
