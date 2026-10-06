/**
 * Phase 23 — verified product reviews (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, customers, getDb, orderItems, orders, productReviews, products, productVariants, tenants } from "./index";
import {
  getProductRatingSummaries,
  getReviewableItems,
  getShopReviewHighlights,
  getTenantReviewStats,
  listProductReviews,
  listReviewRequestCandidates,
  listReportedReviews,
  listTenantReviews,
  replyToReview,
  reportReview,
  resolveReviewReport,
  reviewDisplayName,
  reviewEligibility,
  setReviewHidden,
  submitReview,
} from "./queries/reviews";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 6);
let tenantId = "";
let otherTenant = "";
const productId: Record<string, string> = {};

async function order(state: { orderState?: string; fulfillmentState?: string; daysAgo?: number }, keys: string[], tenant = tenantId) {
  const [o] = await db
    .insert(orders)
    .values({
      tenantId: tenant,
      orderNumber: `REV-${run}-${randomUUID().slice(0, 6)}`,
      status: "paid",
      paymentStatus: "paid",
      paymentState: "paid",
      paymentMethod: "gcash",
      subtotal: "100",
      total: "100",
      guestName: "ana maria reyes",
      orderState: state.orderState ?? "open",
      fulfillmentState: state.fulfillmentState ?? "delivered",
      createdAt: new Date(Date.now() - (state.daysAgo ?? 3) * 86_400_000),
    } as typeof orders.$inferInsert)
    .returning();
  const items: string[] = [];
  for (const k of keys) {
    const [i] = await db
      .insert(orderItems)
      .values({ orderId: o!.id, productId: productId[k] ?? null, titleSnapshot: k, quantity: 1, unitPrice: "100", lineTotal: "100" })
      .returning();
    items.push(i!.id);
  }
  return { orderId: o!.id, items };
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-rev-${run}`, name: "Review Shop", status: "active" }).returning();
  tenantId = t!.id;
  const [t2] = await db.insert(tenants).values({ slug: `test-rev2-${run}`, name: "Other Shop", status: "active" }).returning();
  otherTenant = t2!.id;
  for (const k of ["mug", "tote"]) {
    const [p] = await db.insert(products).values({ tenantId, title: `Item ${k}`, slug: `${k}-${run}`, status: "active", basePrice: "100" }).returning();
    productId[k] = p!.id;
    await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "100", stockQty: 5 });
  }
});

after(async () => {
  for (const t of [tenantId, otherTenant]) {
    await db.delete(customers).where(eq(customers.tenantId, t));
    await db.delete(productReviews).where(eq(productReviews.tenantId, t));
    const ids = (await db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, t))).map((r) => r.id);
    if (ids.length) await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orders).where(eq(orders.tenantId, t));
  }
  await db.delete(productVariants).where(inArray(productVariants.productId, Object.values(productId)));
  await db.delete(products).where(eq(products.tenantId, tenantId));
  await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenant]));
  await closeDb();
});

describe("review rules (pure)", () => {
  it("shown names never include the full surname", () => {
    assert.equal(reviewDisplayName("ana maria reyes"), "Ana R.");
    assert.equal(reviewDisplayName("Bea"), "Bea");
    assert.equal(reviewDisplayName("  "), "Buyer");
    assert.equal(reviewDisplayName(null), "Buyer");
    assert.equal(reviewDisplayName("Walk-in"), "Buyer");
  });
  it("only delivered or completed, not cancelled, within 120 days", () => {
    const now = new Date();
    assert.equal(reviewEligibility({ orderState: "open", fulfillmentState: "delivered", createdAt: now }).ok, true);
    assert.equal(reviewEligibility({ orderState: "completed", fulfillmentState: "unfulfilled", createdAt: now }).ok, true, "pickup completed");
    assert.equal(reviewEligibility({ orderState: "open", fulfillmentState: "out_for_delivery", createdAt: now }).ok, false);
    assert.equal(reviewEligibility({ orderState: "cancelled", fulfillmentState: "delivered", createdAt: now }).ok, false);
    assert.equal(reviewEligibility({ orderState: "completed", fulfillmentState: "delivered", createdAt: new Date(now.getTime() - 121 * 86_400_000) }).ok, false);
  });
});

describe("reviews (database)", () => {
  let reviewId = "";
  it("a delivered order's items can be rated once each", async () => {
    const o = await order({}, ["mug", "tote"]);
    const before = await getReviewableItems(o.orderId);
    assert.equal(before.eligible, true);
    assert.equal(before.items.length, 2);
    const r = await submitReview({ orderId: o.orderId, orderItemId: o.items[0]!, rating: 5, body: "  Ganda!  ", photos: ["/uploads/reviews/a.webp", "b", "c", "d"] });
    reviewId = r.id;
    await assert.rejects(submitReview({ orderId: o.orderId, orderItemId: o.items[0]!, rating: 1 }), /already rated/);
    const after = await getReviewableItems(o.orderId);
    assert.equal(after.items.find((i) => i.orderItemId === o.items[0])?.review?.rating, 5);
    assert.equal(after.items.find((i) => i.orderItemId === o.items[0])?.review?.photos.length, 3, "max 3 photos");
    await submitReview({ orderId: o.orderId, orderItemId: o.items[1]!, rating: 2, body: "Late" });
  });

  it("not-yet-delivered, cancelled and other-order items are refused", async () => {
    const shipping = await order({ fulfillmentState: "out_for_delivery" }, ["mug"]);
    await assert.rejects(submitReview({ orderId: shipping.orderId, orderItemId: shipping.items[0]!, rating: 5 }), /once the order is delivered/);
    const cancelled = await order({ orderState: "cancelled" }, ["mug"]);
    await assert.rejects(submitReview({ orderId: cancelled.orderId, orderItemId: cancelled.items[0]!, rating: 5 }), /cancelled/);
    const other = await order({}, ["mug"]);
    await assert.rejects(submitReview({ orderId: shipping.orderId, orderItemId: other.items[0]!, rating: 5 }), /isn't on this order/);
    await assert.rejects(submitReview({ orderId: other.orderId, orderItemId: other.items[0]!, rating: 9 }), /1 to 5/);
  });

  it("storefront numbers come from published reviews only", async () => {
    let s = await getProductRatingSummaries(tenantId);
    assert.deepEqual(s.get(productId.mug!), { average: 5, count: 1 });
    assert.deepEqual(s.get(productId.tote!), { average: 2, count: 1 });
    const list = await listTenantReviews(tenantId, "low");
    await setReviewHidden(tenantId, list[0]!.id, true, "Courier issue, not the product");
    s = await getProductRatingSummaries(tenantId);
    assert.equal(s.get(productId.tote!), undefined, "hidden reviews don't count");
    await assert.rejects(setReviewHidden(tenantId, list[0]!.id, true, ""), /Say why/);
    const shop = await getShopReviewHighlights(tenantId);
    assert.deepEqual(shop.rating, { average: 5, count: 1 });
    assert.equal(shop.photoReviews.length, 1);
    assert.equal(shop.photoReviews[0]?.buyerName, "Ana R.");
  });

  it("seller replies; other shops can't touch the review", async () => {
    await replyToReview(tenantId, reviewId, "Salamat po!");
    assert.equal((await listProductReviews(tenantId, productId.mug!))[0]?.sellerReply, "Salamat po!");
    await assert.rejects(replyToReview(otherTenant, reviewId, "hi"), /not found/);
    const stats = await getTenantReviewStats(tenantId);
    assert.equal(stats.count, 1);
    assert.equal(stats.needsReply, 0);
  });

  it("report → ops removes it for good", async () => {
    await reportReview(tenantId, reviewId, "Has the buyer's phone number");
    await assert.rejects(reportReview(tenantId, reviewId, "again"), /Already reported/);
    const queue = await listReportedReviews("open");
    assert.ok(queue.some((r) => r.id === reviewId && r.tenantName === "Review Shop"));
    await resolveReviewReport(reviewId, "removed");
    await assert.rejects(resolveReviewReport(reviewId, "kept"), /already decided/);
    await assert.rejects(setReviewHidden(tenantId, reviewId, false), /can't be shown again/);
    assert.equal((await listProductReviews(tenantId, productId.mug!)).length, 0);
  });
});

describe("review request candidates", () => {
  it("only shops that turned it on, buyers who said yes, 2–14 days after, no review yet", async () => {
    const phone = `0917${String(Date.now()).slice(-7)}`;
    const o = await order({ orderState: "completed", daysAgo: 3 }, ["mug"]);
    await db.update(orders).set({ guestPhone: phone, completedAt: new Date(Date.now() - 3 * 86_400_000) } as never).where(eq(orders.id, o.orderId));
    await db.insert(customers).values({ tenantId, phone: `+63${phone.slice(1)}`, name: "Ana", smsMarketingOptIn: true });
    let ids = await listReviewRequestCandidates();
    assert.ok(!ids.includes(o.orderId), "off by default");
    await db.update(tenants).set({ settingsJson: { automations: { review_request: true } } } as never).where(eq(tenants.id, tenantId));
    ids = await listReviewRequestCandidates();
    assert.ok(ids.includes(o.orderId));
    await submitReview({ orderId: o.orderId, orderItemId: o.items[0]!, rating: 4 });
    ids = await listReviewRequestCandidates();
    assert.ok(!ids.includes(o.orderId), "already reviewed");
  });
});
