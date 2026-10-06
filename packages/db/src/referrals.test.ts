/**
 * Phase 32 — buyer referrals and the Suki win-back segment (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, customers, getDb, giftCards, giftCardTxns, loyaltyLedger, orders, referrals, tenants } from "./index";
import { normalizeReferralCode, referralRules } from "./types/loyalty";
import { attachReferralCode, ensureReferralCode, getReferralSummary, saveReferralSettings, syncReferrals } from "./queries/referrals";
import { getOrderLoyalty, saveLoyaltySettings } from "./queries/loyalty";
import { previewSegment } from "./queries/campaigns";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 6);
let tenantId = "";
const c: Record<string, string> = {};
const base = String(Date.now()).slice(-6);
const phone = (n: number) => `+639${base}${String(n).padStart(3, "0")}`;

async function order(customerId: string, total: number, extra: Record<string, unknown> = {}, daysAgo = 0) {
  const [o] = await db
    .insert(orders)
    .values({ tenantId, customerRecordId: customerId, orderNumber: `REF-${run}-${randomUUID().slice(0, 6)}`, status: "paid", paymentStatus: "paid", paymentState: "paid", paymentMethod: "gcash", subtotal: String(total), total: String(total), createdAt: new Date(Date.now() - daysAgo * 86_400_000), ...extra } as typeof orders.$inferInsert)
    .returning();
  return o!.id;
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-ref-${run}`, name: "Referral Shop", status: "active" }).returning();
  tenantId = t!.id;
  const names = ["ana", "bea", "cid", "dan", "eli", "ana2"];
  for (const [i, n] of names.entries()) {
    const [row] = await db
      .insert(customers)
      .values({ tenantId, phone: n === "ana2" ? phone(0).replace(/^\+63/, "0") : phone(i), name: n, smsMarketingOptIn: true })
      .returning();
    c[n] = row!.id;
  }
});

after(async () => {
  await db.delete(referrals).where(eq(referrals.tenantId, tenantId));
  await db.delete(loyaltyLedger).where(eq(loyaltyLedger.tenantId, tenantId));
  await db.delete(giftCardTxns).where(eq(giftCardTxns.tenantId, tenantId));
  await db.delete(giftCards).where(eq(giftCards.tenantId, tenantId));
  await db.delete(orders).where(eq(orders.tenantId, tenantId));
  await db.delete(customers).where(eq(customers.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("referral rules (pure)", () => {
  it("defaults and clamping", () => {
    assert.deepEqual(referralRules({}), { enabled: false, referrerReward: 50, friendReward: 50, minOrder: 300, monthlyCap: 10 });
    assert.equal(referralRules({ referral: { referrerReward: 99999, monthlyCap: 0 } }).referrerReward, 5000);
    assert.equal(referralRules({ referral: { monthlyCap: 0 } }).monthlyCap, 1);
  });
  it("codes are normalized and look-alike-free", () => {
    assert.equal(normalizeReferralCode(" s-abc 234 "), "SABC234");
    assert.equal(normalizeReferralCode("XABC234"), null);
    assert.equal(normalizeReferralCode(null), null);
  });
});

describe("referrals (database)", () => {
  let anaCode = "";
  it("each buyer gets one stable code", async () => {
    anaCode = await ensureReferralCode(tenantId, c.ana!);
    assert.match(anaCode, /^S[A-Z0-9]{6}$/);
    assert.equal(await ensureReferralCode(tenantId, c.ana!), anaCode);
  });

  it("codes only stick to orders when referrals are on, the code is real, and it's someone else's", async () => {
    await order(c.ana!, 500, {}, 10); // Ana is a paying customer
    const beaOrder = await order(c.bea!, 600);
    assert.equal(await attachReferralCode(tenantId, beaOrder, anaCode), false, "off");
    await saveReferralSettings(tenantId, { enabled: true });
    await saveLoyaltySettings(tenantId, { enabled: true }); // keeps the referral rules
    assert.equal(await attachReferralCode(tenantId, beaOrder, "SZZZZZZ"), false, "unknown code");
    const anaOwn = await order(c.ana!, 400);
    assert.equal(await attachReferralCode(tenantId, anaOwn, anaCode), false, "own code");
    assert.equal(await attachReferralCode(tenantId, beaOrder, anaCode.toLowerCase()), true);
  });

  it("the friend's first paid order rewards both, once — even with two sweeps at once", async () => {
    const r = await Promise.all([syncReferrals({ tenantId }), syncReferrals({ tenantId })]);
    assert.equal(r[0].rewarded + r[1].rewarded, 1);
    const cards = await db.select().from(giftCards).where(eq(giftCards.tenantId, tenantId));
    assert.equal(cards.length, 2);
    assert.ok(cards.every((k) => k.kind === "store_credit" && Number(k.balance) === 50));
    assert.deepEqual(new Set(cards.map((k) => k.customerId)), new Set([c.ana, c.bea]));
  });

  it("blocks: not the first order, same phone, too small, referrer never paid; and the monthly cap", async () => {
    const beaAgain = await order(c.bea!, 900);
    await db.update(orders).set({ referralCode: anaCode } as never).where(eq(orders.id, beaAgain)); // already a referred friend
    const ana2 = await order(c.ana2!, 900); // same phone as Ana
    await attachReferralCode(tenantId, ana2, anaCode);
    const small = await order(c.cid!, 200);
    await attachReferralCode(tenantId, small, anaCode);
    const danCode = await ensureReferralCode(tenantId, c.dan!); // Dan never paid
    const eliOrder = await order(c.eli!, 900);
    await attachReferralCode(tenantId, eliOrder, danCode);
    const r = await syncReferrals({ tenantId });
    assert.equal(r.rewarded, 0);
    const rows = await db.select().from(referrals).where(eq(referrals.tenantId, tenantId));
    const reasons = rows.filter((x) => x.status === "blocked").map((x) => x.reason).sort();
    assert.deepEqual(reasons, ["First order under ₱300", "Referrer has no paid order yet", "Same buyer"]);
    assert.equal((await syncReferrals({ tenantId })).blocked, 0, "blocked friends aren't re-checked");
  });

  it("the monthly cap stops extra rewards", async () => {
    await saveReferralSettings(tenantId, { monthlyCap: 1 });
    const [f] = await db.insert(customers).values({ tenantId, phone: phone(77), name: "fay" }).returning();
    const o = await order(f!.id, 800);
    await attachReferralCode(tenantId, o, anaCode);
    await syncReferrals({ tenantId });
    const row = (await db.select().from(referrals).where(eq(referrals.friendCustomerId, f!.id)))[0];
    assert.equal(row?.reason, "Referrer reached this month's limit");
  });

  it("the buyer's order view carries their share code; the summary counts rewards", async () => {
    const v = await getOrderLoyalty((await db.select().from(orders).where(eq(orders.customerRecordId, c.bea!)))[0]!.id);
    assert.match(v?.referral?.code ?? "", /^S[A-Z0-9]{6}$/);
    assert.equal(v?.referral?.friendReward, 50);
    const s = await getReferralSummary(tenantId);
    assert.equal(s.rewarded30d, 1);
    assert.equal(s.creditIssued30d, 100);
    assert.equal(s.topReferrers[0]?.name, "ana");
  });
});

describe("Suki win-back segment", () => {
  it("Silver+ buyers (12-month spend) who haven't ordered in N days, with consent", async () => {
    const [g] = await db.insert(customers).values({ tenantId, phone: "09171234999", name: "gio", smsMarketingOptIn: true }).returning();
    await order(g!.id, 6000, {}, 90); // Silver by spend, last order 90 days ago
    const p = await previewSegment(tenantId, { kind: "suki", minTier: "silver", days: 45 });
    assert.equal(p.count, 1);
    assert.deepEqual(p.sample, ["gio"]);
    assert.equal((await previewSegment(tenantId, { kind: "suki", minTier: "gold", days: 45 })).count, 0);
  });
});
