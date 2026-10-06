/**
 * Phase 19 — forgot password (local Postgres only). Codes for eligible accounts only, the code
 * is single-use, weak passwords don't burn it, and a reset signs out every older session.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, emailVerificationCodes, getDb, tenants, users } from "@gumakart/db";
import { issueEmailCode } from "./email-code";
import { canResetPassword, isSessionCurrent, loginUser, resetPasswordWithCode } from "./service";
import { hashPassword } from "./password";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

// Test-only signing secret (read lazily by the code under test).
process.env.AUTH_SECRET ??= "test-only-password-reset-secret-0123456789";

const db = getDb();
const run = randomUUID().slice(0, 8);
const owner = { email: `reset-owner-${run}@example.com`, id: "" };
const removed = { email: `reset-removed-${run}@example.com`, id: "" };
const partner = { email: `reset-partner-${run}@example.com`, id: "" };
const buyer = { email: `reset-buyer-${run}@example.com`, id: "" };
let tenantId = "";

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-reset-${run}`, name: "Reset Shop", status: "active" }).returning();
  tenantId = t!.id;
  const hash = await hashPassword("OldPassword1");
  const rows = await db
    .insert(users)
    .values([
      { email: owner.email, passwordHash: hash, role: "seller_owner", tenantId, emailVerifiedAt: new Date() },
      { email: removed.email, passwordHash: hash, role: "seller_staff", staffRole: "staff", tenantId, status: "removed" },
      { email: partner.email, passwordHash: hash, role: "partner" },
      { email: buyer.email, passwordHash: hash, role: "customer" },
    ])
    .returning({ id: users.id, email: users.email });
  for (const r of rows) for (const o of [owner, removed, partner, buyer]) if (o.email === r.email) o.id = r.id;
});

after(async () => {
  await db.delete(emailVerificationCodes).where(inArray(emailVerificationCodes.email, [owner.email, removed.email, partner.email, buyer.email]));
  await db.delete(users).where(inArray(users.id, [owner.id, removed.id, partner.id, buyer.id]));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("forgot password", () => {
  it("only active seller-app accounts can reset", async () => {
    assert.equal(await canResetPassword(owner.email.toUpperCase()), true);
    assert.equal(await canResetPassword(partner.email), true);
    assert.equal(await canResetPassword(removed.email), false, "removed staff");
    assert.equal(await canResetPassword(buyer.email), false, "buyer accounts aren't seller logins");
    assert.equal(await canResetPassword(`nobody-${run}@example.com`), false);
  });

  it("a weak password doesn't burn the code; a reset signs out old sessions; the code is single-use", async () => {
    const before = await loginUser({ email: owner.email, password: "OldPassword1" });
    const { code } = await issueEmailCode(owner.email, "reset");
    await assert.rejects(resetPasswordWithCode({ email: owner.email, code, password: "short" }), /WEAK|least|password/i);
    const res = await resetPasswordWithCode({ email: owner.email, code, password: "NewPassword2" });
    assert.equal(res.user.userId, owner.id);
    assert.equal(await isSessionCurrent(owner.id, before.user.sessionVersion), false, "old sessions are signed out");
    assert.equal(await isSessionCurrent(owner.id, res.user.sessionVersion), true, "the new one works");
    await assert.rejects(loginUser({ email: owner.email, password: "OldPassword1" }));
    assert.ok(await loginUser({ email: owner.email, password: "NewPassword2" }));
    await assert.rejects(resetPasswordWithCode({ email: owner.email, code, password: "AnotherPass3" }), /expired|used/i);
  });

  it("a wrong code fails; a removed account can't use a code issued before removal", async () => {
    const { code } = await issueEmailCode(partner.email, "reset");
    await assert.rejects(resetPasswordWithCode({ email: partner.email, code: code === "000000" ? "111111" : "000000", password: "PartnerPass4" }), /isn't right|tries/i);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, partner.id));
    await assert.rejects(resetPasswordWithCode({ email: partner.email, code, password: "PartnerPass4" }), /expired/i);
    await db.update(users).set({ status: "active" }).where(eq(users.id, partner.id));
  });

  it("a signup code can't be used to reset", async () => {
    const { code } = await issueEmailCode(buyer.email, "signup");
    await db.update(users).set({ role: "seller_owner", tenantId }).where(eq(users.id, buyer.id));
    await assert.rejects(resetPasswordWithCode({ email: buyer.email, code, password: "BuyerPass55" }), /expired/i);
  });
});
