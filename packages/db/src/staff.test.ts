/**
 * Phase 10 — staff accounts and the activity log (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  acceptStaffInvite,
  changeStaffRole,
  createStaffInvite,
  getStaffInvite,
  listTeam,
  removeStaff,
  revokeStaffInvite,
  setStaffPin,
  StaffError,
} from "./queries/staff";
import { listActivity, logActivity } from "./queries/activity";
import { activityLog, posStaff, staffInvites, tenants, users } from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", ownerId: "" };
const other = { id: "", ownerId: "" };
const mail = (n: string) => `${n}-${run}@example.com`;
const createdUsers: string[] = [];

before(async () => {
  const [a] = await db.insert(tenants).values({ slug: `test-staff-${run}`, name: "Staff Shop", status: "active" }).returning();
  const [b] = await db.insert(tenants).values({ slug: `test-staff2-${run}`, name: "Other Shop", status: "active" }).returning();
  shop.id = a!.id;
  other.id = b!.id;
  const [o1] = await db.insert(users).values({ email: mail("owner"), role: "seller_owner", tenantId: shop.id, passwordHash: "x" }).returning();
  const [o2] = await db.insert(users).values({ email: mail("owner2"), role: "seller_owner", tenantId: other.id, passwordHash: "x" }).returning();
  shop.ownerId = o1!.id;
  other.ownerId = o2!.id;
  createdUsers.push(o1!.id, o2!.id);
});

after(async () => {
  const tids = [shop.id, other.id];
  await db.delete(activityLog).where(inArray(activityLog.tenantId, tids));
  await db.delete(posStaff).where(inArray(posStaff.tenantId, tids));
  await db.delete(staffInvites).where(inArray(staffInvites.tenantId, tids));
  await db.delete(users).where(inArray(users.tenantId, tids));
  await db.delete(tenants).where(inArray(tenants.id, tids));
  await closeDb();
});

let jenId = "";

describe("invites", () => {
  it("invite → accept creates a verified staff account", async () => {
    const { token, invite } = await createStaffInvite(shop.id, { email: ` ${mail("Jen").toUpperCase()} `, name: "Jen", role: "staff" }, shop.ownerId);
    assert.equal(invite.email, mail("jen"));
    assert.equal(token.length, 32);
    const [row] = await db.select().from(staffInvites).where(eq(staffInvites.id, invite.id));
    assert.notEqual(row!.tokenHash, token, "only the hash is stored");

    const view = await getStaffInvite(token);
    assert.equal(view?.status, "valid");
    assert.equal(view?.hasAccount, false);
    assert.equal(view?.shopName, "Staff Shop");

    const accepted = await acceptStaffInvite({ token, name: "Jen Santos", passwordHash: "hash" });
    jenId = accepted.userId;
    const [u] = await db.select().from(users).where(eq(users.id, jenId));
    assert.equal(u!.role, "seller_staff");
    assert.equal(u!.staffRole, "staff");
    assert.equal(u!.tenantId, shop.id);
    assert.ok(u!.emailVerifiedAt);
    assert.equal(u!.profileJson?.displayName, "Jen Santos");

    await assert.rejects(acceptStaffInvite({ token, name: "Jen", passwordHash: "h" }), (e: unknown) => e instanceof StaffError && e.code === "INVITE_USED");
    assert.equal((await getStaffInvite(token))?.status, "used");
  });

  it("refuses team members, other shops' people and bad emails", async () => {
    await assert.rejects(createStaffInvite(shop.id, { email: mail("jen"), role: "manager" }, null), (e: unknown) => e instanceof StaffError && e.code === "ALREADY_MEMBER");
    await assert.rejects(createStaffInvite(shop.id, { email: mail("owner2"), role: "staff" }, null), (e: unknown) => e instanceof StaffError && e.code === "OTHER_SHOP");
    await assert.rejects(createStaffInvite(shop.id, { email: "not-an-email", role: "staff" }, null), (e: unknown) => e instanceof StaffError && e.code === "INVALID");
    await assert.rejects(createStaffInvite(shop.id, { email: mail("x"), role: "admin" as never }, null), (e: unknown) => e instanceof StaffError);
  });

  it("a new invite replaces the open one; revoked and expired links don't work", async () => {
    const first = await createStaffInvite(shop.id, { email: mail("ben"), role: "cashier" }, null);
    const second = await createStaffInvite(shop.id, { email: mail("ben"), role: "cashier" }, null);
    assert.equal((await getStaffInvite(first.token))?.status, "revoked");
    assert.ok(await revokeStaffInvite(shop.id, second.invite.id));
    await assert.rejects(acceptStaffInvite({ token: second.token, name: "Ben", passwordHash: "h" }), (e: unknown) => e instanceof StaffError && e.code === "INVITE_REVOKED");
    assert.equal(await revokeStaffInvite(other.id, second.invite.id), false, "other shop can't touch it");

    const third = await createStaffInvite(shop.id, { email: mail("ben"), role: "cashier" }, null);
    await db.update(staffInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(staffInvites.id, third.invite.id));
    await assert.rejects(acceptStaffInvite({ token: third.token, name: "Ben", passwordHash: "h" }), (e: unknown) => e instanceof StaffError && e.code === "INVITE_EXPIRED");
    assert.equal(await getStaffInvite("nope-not-a-token"), null);
  });

  it("an existing account must be the one accepting", async () => {
    const [cust] = await db.insert(users).values({ email: mail("lito"), role: "customer", passwordHash: "x" }).returning();
    createdUsers.push(cust!.id);
    const { token } = await createStaffInvite(shop.id, { email: mail("lito"), role: "manager" }, null);
    assert.equal((await getStaffInvite(token))?.hasAccount, true);
    await assert.rejects(acceptStaffInvite({ token, name: "Lito", existingUserId: jenId }), (e: unknown) => e instanceof StaffError && e.code === "EMAIL_MISMATCH");
    const ok = await acceptStaffInvite({ token, name: "Lito", existingUserId: cust!.id });
    assert.equal(ok.role, "manager");
    const [u] = await db.select().from(users).where(eq(users.id, cust!.id));
    assert.equal(u!.role, "seller_staff");
    assert.equal(u!.sessionVersion, 1, "old sessions of that account are cut");
  });
});

describe("managing staff", () => {
  it("lists the team with the owner first", async () => {
    const { members } = await listTeam(shop.id);
    assert.equal(members[0]!.role, "owner");
    assert.deepEqual(
      members.map((m) => m.role).sort(),
      ["manager", "owner", "staff"]
    );
  });

  it("role change signs the person out; PIN links to the account", async () => {
    const before = (await db.select().from(users).where(eq(users.id, jenId)))[0]!.sessionVersion;
    await setStaffPin(shop.id, jenId, "pinhash");
    const { from } = await changeStaffRole(shop.id, jenId, "manager");
    assert.equal(from, "staff");
    const [u] = await db.select().from(users).where(eq(users.id, jenId));
    assert.equal(u!.staffRole, "manager");
    assert.equal(u!.sessionVersion, before + 1);
    const [pin] = await db.select().from(posStaff).where(eq(posStaff.userId, jenId));
    assert.equal(pin!.role, "manager", "POS role follows the account");
    assert.equal(pin!.name, "Jen Santos");
    assert.equal((await listTeam(shop.id)).members.find((m) => m.userId === jenId)?.hasPin, true);

    await assert.rejects(changeStaffRole(shop.id, shop.ownerId, "staff"), (e: unknown) => e instanceof StaffError && e.code === "OWNER");
    await assert.rejects(changeStaffRole(other.id, jenId, "staff"), (e: unknown) => e instanceof StaffError && e.code === "NOT_FOUND");
  });

  it("removing keeps history but ends access and the PIN", async () => {
    await removeStaff(shop.id, jenId);
    const [u] = await db.select().from(users).where(eq(users.id, jenId));
    assert.equal(u!.status, "removed");
    assert.equal(u!.staffRole, null);
    const [pin] = await db.select().from(posStaff).where(eq(posStaff.userId, jenId));
    assert.equal(pin!.active, false);
    assert.ok(!(await listTeam(shop.id)).members.some((m) => m.userId === jenId));
    // They can be invited back.
    const again = await createStaffInvite(shop.id, { email: mail("jen"), role: "cashier" }, null);
    const back = await acceptStaffInvite({ token: again.token, name: "Jen", existingUserId: jenId });
    assert.equal(back.role, "cashier");
  });
});

describe("activity log", () => {
  it("records and filters by person and kind, scoped to the shop", async () => {
    await logActivity(shop.id, { userId: shop.ownerId, name: "Tess", role: "owner" }, { action: "order.payment_confirmed", summary: "Confirmed payment for X-1" });
    await logActivity(shop.id, { userId: jenId, name: "Jen", role: "cashier" }, { action: "pos.shift_closed", summary: "Closed the POS shift" });
    await logActivity(other.id, { userId: other.ownerId, name: "Other", role: "owner" }, { action: "order.refunded", summary: "x" });
    const all = await listActivity(shop.id);
    assert.equal(all.length, 2);
    assert.equal(all[0]!.action, "pos.shift_closed", "newest first");
    assert.equal((await listActivity(shop.id, { actorUserId: shop.ownerId })).length, 1);
    assert.equal((await listActivity(shop.id, { actionPrefix: "order." })).length, 1);
  });

  it("never throws when it can't write", async () => {
    await logActivity("00000000-0000-4000-8000-000000000000", { userId: null, name: "x", role: null }, { action: "x", summary: "y" });
  });
});
