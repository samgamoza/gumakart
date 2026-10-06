/**
 * Phase 27 — Suki loyalty (unit rules + local Postgres integration).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, customers, getDb, giftCards, giftCardTxns, loyaltyLedger, orders, tenants } from "./index";
import { creditFor, loyaltyRules, nextTier, pointsFor, tierFor } from "./types/loyalty";
import {
  getCustomerLoyalty,
  getLoyaltySummary,
  getOrderLoyalty,
  redeemLoyaltyPoints,
  saveLoyaltySettings,
  syncLoyaltyPoints,
} from "./queries/loyalty";

describe("loyalty rules (pure)", () => {
  const r = loyaltyRules({ enabled: true });
  it("defaults: ₱100 = 1 pt, 1 pt = ₱1, tiers 5k / 15k / 40k", () => {
    assert.equal(r.pesoPerPoint, 100);
    assert.equal(r.pointValue, 1);
    assert.deepEqual(r.tiers, { silver: 5000, gold: 15000, platinum: 40000 });
  });
  it("tiers and multipliers", () => {
    assert.equal(tierFor(4999, r), "bronze");
    assert.equal(tierFor(5000, r), "silver");
    assert.equal(tierFor(40000, r), "platinum");
    assert.equal(pointsFor(1999, "bronze", r), 19);
    assert.equal(pointsFor(1000, "silver", r), 12, "10 × 1.25 = 12.5 → 12");
    assert.equal(pointsFor(1000, "platinum", r), 20);
    assert.equal(pointsFor(-5, "gold", r), 0);
    assert.deepEqual(nextTier(4000, r), { tier: "silver", needed: 1000 });
    assert.equal(nextTier(50000, r), null);
    assert.equal(creditFor(55, r), 55);
  });
  it("bad settings fall back to safe values; tiers stay in order", () => {
    const b = loyaltyRules({ pesoPerPoint: 0, pointValue: 999, minRedeem: -4, tiers: { silver: 9000, gold: 100, platinum: 50 } });
    assert.equal(b.pesoPerPoint, 20);
    assert.equal(b.pointValue, 5);
    assert.equal(b.minRedeem, 1);
    assert.ok(b.tiers.silver < b.tiers.gold && b.tiers.gold < b.tiers.platinum);
    assert.equal(b.enabled, false);
  });
});

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 8);
let tenantId = "";
let ana = "";
let ben = "";

async function order(customerId: string, total: number, extra: Partial<typeof orders.$inferInsert> = {}, daysAgo = 0) {
  const [o] = await db
    .insert(orders)
    .values({
      tenantId,
      customerRecordId: customerId,
      orderNumber: `LOY-${run}-${randomUUID().slice(0, 6)}`,
      status: "paid",
      paymentStatus: "paid",
      paymentState: "paid",
      paymentMethod: "gcash",
      subtotal: String(total),
      total: String(total),
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      ...extra,
    } as typeof orders.$inferInsert)
    .returning();
  return o!.id;
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-loy-${run}`, name: "Suki Shop", status: "active" }).returning();
  tenantId = t!.id;
  const [a, b] = await db
    .insert(customers)
    .values([
      { tenantId, phone: `+63917${run.slice(0, 7).replace(/\D/g, "1").padEnd(7, "1")}`, name: "Ana" },
      { tenantId, phone: `+63918${run.slice(0, 7).replace(/\D/g, "2").padEnd(7, "2")}`, name: "Ben" },
    ])
    .returning();
  ana = a!.id;
  ben = b!.id;
});

after(async () => {
  await db.delete(loyaltyLedger).where(eq(loyaltyLedger.tenantId, tenantId));
  await db.delete(giftCardTxns).where(eq(giftCardTxns.tenantId, tenantId));
  await db.delete(giftCards).where(eq(giftCards.tenantId, tenantId));
  await db.delete(orders).where(eq(orders.tenantId, tenantId));
  await db.delete(customers).where(inArray(customers.id, [ana, ben]));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("Suki loyalty (database)", () => {
  let oldOrder = "";
  let delivered = "";
  let refunded = "";
  let cancelled = "";

  it("orders before loyalty was turned on never earn; nothing earns while it's off", async () => {
    oldOrder = await order(ana, 3000, {}, 30);
    const r = await syncLoyaltyPoints({ tenantId });
    assert.deepEqual(r, { earned: 0, reversed: 0 }, "off");
    await saveLoyaltySettings(tenantId, { enabled: true });
    assert.deepEqual(await syncLoyaltyPoints({ tenantId }), { earned: 0, reversed: 0 }, "the old order predates enabledAt");
  });

  it("paid orders earn once; unpaid / COD-not-delivered don't; delivery fee and gift-card part don't count", async () => {
    await order(ana, 1250, { deliveryFee: "50", giftCardAmount: "100" } as never); // earns on 1100 → 11
    await order(ana, 999, { paymentStatus: "pending", paymentState: "unpaid" } as never);
    delivered = await order(ben, 800, { paymentStatus: "pending", paymentState: "cod_due", fulfillmentState: "unfulfilled" } as never);
    assert.equal((await syncLoyaltyPoints({ tenantId })).earned, 1);
    assert.equal((await syncLoyaltyPoints({ tenantId })).earned, 0, "second run adds nothing");
    assert.equal((await getCustomerLoyalty(tenantId, ana)).points, 11);
    await db.update(orders).set({ fulfillmentState: "delivered" } as never).where(eq(orders.id, delivered));
    await syncLoyaltyPoints({ tenantId });
    assert.equal((await getCustomerLoyalty(tenantId, ben)).points, 8, "COD earns once delivered");
  });

  it("tier comes from the last 12 months' spend (the old order counts toward it) and multiplies earnings", async () => {
    // Ana: 3000 (old) + 1100 = 4100 → bronze. A 1000 order puts her past silver afterwards.
    await order(ana, 1000);
    await syncLoyaltyPoints({ tenantId });
    const a = await getCustomerLoyalty(tenantId, ana);
    assert.equal(a.points, 21, "this order was earned at bronze (4100 before it)");
    assert.equal(a.tier, "silver");
    await order(ana, 1000);
    await syncLoyaltyPoints({ tenantId });
    assert.equal((await getCustomerLoyalty(tenantId, ana)).points, 33, "next one at silver: 10 × 1.25 = 12");
  });

  it("refunds and cancellations take the points back (and stay in step)", async () => {
    refunded = await order(ben, 2000);
    cancelled = await order(ben, 500);
    await syncLoyaltyPoints({ tenantId });
    assert.equal((await getCustomerLoyalty(tenantId, ben)).points, 8 + 20 + 5);
    await db.update(orders).set({ refundedAmount: "500", paymentState: "partially_refunded" } as never).where(eq(orders.id, refunded));
    await db.update(orders).set({ orderState: "cancelled" } as never).where(eq(orders.id, cancelled));
    const r = await syncLoyaltyPoints({ tenantId });
    assert.equal(r.reversed, 2);
    assert.equal((await getCustomerLoyalty(tenantId, ben)).points, 8 + 15);
    assert.equal((await syncLoyaltyPoints({ tenantId })).reversed, 0, "unchanged orders aren't rewritten");
    await db.update(orders).set({ refundedAmount: "2000", paymentState: "refunded" } as never).where(eq(orders.id, refunded));
    await syncLoyaltyPoints({ tenantId });
    assert.equal((await getCustomerLoyalty(tenantId, ben)).points, 8);
  });

  it("converting points makes a store-credit card and can't overspend, even with two clicks at once", async () => {
    await assert.rejects(redeemLoyaltyPoints({ tenantId, customerId: ana, points: 10, actorName: "Owner" }), /at least 50/);
    await saveLoyaltySettings(tenantId, { minRedeem: 20 });
    const results = await Promise.allSettled([
      redeemLoyaltyPoints({ tenantId, customerId: ana, points: 30, actorName: "Owner" }),
      redeemLoyaltyPoints({ tenantId, customerId: ana, points: 30, actorName: "Owner" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "33 points can't pay for 60");
    const ok = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof redeemLoyaltyPoints>>>;
    assert.equal(ok.value.amount, 30);
    assert.equal(ok.value.card.kind, "store_credit");
    assert.equal(Number(ok.value.card.balance), 30);
    assert.equal((await getCustomerLoyalty(tenantId, ana)).points, 3);
  });

  it("summary and the buyer's order view", async () => {
    const s = await getLoyaltySummary(tenantId);
    assert.equal(s.members.silver, 1);
    assert.equal(s.pointsOutstanding, 3 + 8);
    assert.equal(s.redeemed30d, 30);
    const v = await getOrderLoyalty(delivered);
    assert.equal(v?.earned, 8);
    assert.equal(v?.balance, 8);
    const unpaid = await order(ben, 600, { paymentStatus: "pending", paymentState: "pending_verification" } as never);
    assert.equal((await getOrderLoyalty(unpaid))?.pending, 6, "shows what it will earn once paid");
    await saveLoyaltySettings(tenantId, { enabled: false });
    assert.equal(await getOrderLoyalty(delivered), null, "hidden when the shop turns it off");
  });
});
