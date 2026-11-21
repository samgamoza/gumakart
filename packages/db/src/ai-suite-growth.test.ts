/** AI Marketing Suite Phases 4 + 5 (migration 0050): segments, broadcasts, reorder, review loop, Printair. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  cancelBroadcast,
  claimBroadcastBatches,
  completeReviewFromChat,
  createBroadcast,
  createPrintairUpsell,
  createReorderLink,
  decideReach,
  fillBroadcastTemplate,
  findOpenReviewPrompt,
  finishBroadcastIfDone,
  getActivePrintairCard,
  getBroadcast,
  getSegmentCounts,
  listDueReviewPrompts,
  listPrintairCandidates,
  loadAudience,
  markReviewPrompt,
  orderMilestoneFor,
  paydayPeriod,
  previewBroadcastAudience,
  queueBroadcast,
  recordBroadcastSend,
  refreshBuyerSegments,
  saveAiSuiteSettings,
  scheduleReviewPrompt,
  setPrintairCardStatus,
  syncPrintairUpsells,
  type AudienceRow,
} from "./queries/ai-suite-growth";
import { enqueueAiMediaJob } from "./queries/ai-media-jobs";
import { redeemGiftCardInTx } from "./queries/gift-cards";
import { createOrderForTenant } from "./queries/orders";
import { recordSocialMessage, upsertSocialAccount } from "./queries/social-inbox";
import {
  aiMediaJobs,
  aiSuiteSettings,
  broadcastCampaigns,
  broadcastRecipients,
  checkoutLinkItems,
  checkoutLinks,
  customers,
  giftCards,
  orders,
  printairUpsells,
  productReviews,
  productVariants,
  products,
  reviewPrompts,
  socialAccounts,
  socialMessages,
  socialThreads,
  tenants,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-p45-${run}` };
const ids = { product: "", variant: "", product2: "", messenger: "", whatsapp: "" };
const phone = (n: number) => `0917${run.replace(/\D/g, "").padEnd(3, "7").slice(0, 3)}${String(n).padStart(4, "0")}`;

async function order(p: string, name: string, at: Date, opts: { productId?: string; qty?: number } = {}) {
  const o = await createOrderForTenant({
    tenantSlug: shop.slug,
    items: [{ productId: opts.productId ?? ids.product, quantity: opts.qty ?? 1 }],
    customer: { name, phone: p },
    deliveryType: "pickup",
    paymentMethod: "cod",
    deliveryFee: 0,
    minOrderAmount: 0,
  });
  await db.execute(sql`update orders set created_at = ${at.toISOString()}::timestamptz where id = ${o.id}`);
  return o.id;
}

/** A Manila calendar day N days ago at 12:00 (so the day-of-month is unambiguous). */
function onDay(day: number, monthsAgo: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, day, 4, 0, 0));
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "P45 Bakery", status: "active", subscriptionPlan: "pro_live" }).returning();
  shop.id = t!.id;
  const [p] = await db.insert(products).values({ tenantId: shop.id, title: "Ube Cheese Pandesal", slug: `ube-${run}`, status: "active", basePrice: "240.00", trackInventory: false }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "240.00", stockQty: 0, sku: `P45-${run}` }).returning();
  const [p2] = await db.insert(products).values({ tenantId: shop.id, title: "Old Item", slug: `old-${run}`, status: "archived", basePrice: "100.00", trackInventory: false }).returning();
  await db.insert(productVariants).values({ productId: p2!.id, title: "Default", price: "100.00", stockQty: 0, sku: `P45O-${run}` });
  const m = await upsertSocialAccount({ tenantId: shop.id, platform: "messenger", externalId: `pg-${run}`, name: "Page", pageId: `pg-${run}`, accessTokenSealed: null, status: "mock" });
  const w = await upsertSocialAccount({ tenantId: shop.id, platform: "whatsapp", externalId: `wa-${run}`, name: "WA", pageId: null, accessTokenSealed: null, status: "mock" });
  Object.assign(ids, { product: p!.id, variant: v!.id, product2: p2!.id, messenger: m.id, whatsapp: w.id });
});

after(async () => {
  const tid = [shop.id];
  const c = async (q: Promise<unknown>) => q.catch(() => undefined);
  await c(db.delete(broadcastRecipients).where(inArray(broadcastRecipients.tenantId, tid)));
  await c(db.delete(broadcastCampaigns).where(inArray(broadcastCampaigns.tenantId, tid)));
  await c(db.delete(reviewPrompts).where(inArray(reviewPrompts.tenantId, tid)));
  await c(db.delete(productReviews).where(inArray(productReviews.tenantId, tid)));
  await c(db.delete(printairUpsells).where(inArray(printairUpsells.tenantId, tid)));
  await c(db.delete(aiMediaJobs).where(inArray(aiMediaJobs.tenantId, tid)));
  await c(db.delete(aiSuiteSettings).where(inArray(aiSuiteSettings.tenantId, tid)));
  await c(db.update(socialThreads).set({ activeCheckoutLinkId: null }).where(inArray(socialThreads.tenantId, tid)));
  await c(db.delete(socialMessages).where(inArray(socialMessages.tenantId, tid)));
  // Orders, payments, gift cards and stock movements are append-only: the test shop is left in place (run-scoped slug).
  await closeDb();
});

describe("4.1 buyer segments", () => {
  it("tags VIP_REPEAT (3+), PAYDAY_SHOPPER (mostly 13–17 / 28–31), INACTIVE_60D", async () => {
    // Ana: 3 orders, all on payday days → VIP + PAYDAY
    for (const [d, m] of [[15, 1], [30, 1], [14, 0]] as const) await order(phone(1), "Ana Cruz", onDay(d, m));
    // Ben: 1 order 90 days ago on the 5th → INACTIVE only
    await order(phone(2), "Ben Reyes", new Date(Date.now() - 90 * 86_400_000 - (new Date().getUTCDate() === 5 ? 86_400_000 : 0)));
    // Cora: 2 orders, one payday, one not → PAYDAY (≥ 50%)
    await order(phone(3), "Cora Lim", onDay(16, 1));
    await order(phone(3), "Cora Lim", onDay(8, 0));
    const n = await refreshBuyerSegments(shop.id);
    assert.equal(n, 3);
    const rows = (await db.execute(sql`select phone, tags, total_orders from buyer_crm_segments where tenant_id = ${shop.id} order by phone`)) as unknown as Array<{ phone: string; tags: string[]; total_orders: number }>;
    const byPhone = Object.fromEntries(rows.map((r) => [r.phone, r.tags.sort()]));
    assert.deepEqual(byPhone[phone(1)], ["PAYDAY_SHOPPER", "VIP_REPEAT"]);
    assert.ok(byPhone[phone(2)]!.includes("INACTIVE_60D"));
    assert.ok(!byPhone[phone(2)]!.includes("VIP_REPEAT"));
    assert.deepEqual(byPhone[phone(3)], ["PAYDAY_SHOPPER"]);
    const counts = await getSegmentCounts(shop.id);
    assert.equal(counts.total, 3);
    assert.equal(counts.tags.VIP_REPEAT, 1);
    assert.equal(counts.tags.PAYDAY_SHOPPER, 2);
  });
  it("payday prompt days are the 14th and 29th (Manila)", () => {
    assert.equal(paydayPeriod(new Date("2026-11-13T16:30:00Z")), "2026-11-14", "00:30 Manila on the 14th");
    assert.equal(paydayPeriod(new Date("2026-11-29T03:00:00Z")), "2026-11-29");
    assert.equal(paydayPeriod(new Date("2026-11-15T03:00:00Z")), null);
  });
});

describe("4.2 broadcasts", () => {
  const base: AudienceRow = { buyerKey: "k", customerId: null, name: "Ana", phone: "09171234567", threadId: null, threadUserId: null, lastInboundAt: null, marketingOptIn: false, optedOut: false, lastOrderId: null, lastItem: null };
  const now = new Date("2026-11-21T08:00:00Z");
  it("reach rules follow Meta's policies", () => {
    const fresh = { ...base, threadId: "t", threadUserId: "psid", lastInboundAt: new Date(now.getTime() - 3_600_000) };
    const stale = { ...fresh, lastInboundAt: new Date(now.getTime() - 30 * 3_600_000) };
    assert.deepEqual(decideReach(fresh, "messenger", false, now), { mode: "session", recipientId: "psid", skipReason: null });
    assert.equal(decideReach(stale, "messenger", true, now).skipReason, "outside_24h", "no promo tags on Messenger");
    assert.equal(decideReach(base, "instagram", true, now).skipReason, "no_chat");
    assert.equal(decideReach({ ...stale, threadUserId: "639171234567" }, "whatsapp", false, now).skipReason, "needs_template");
    assert.deepEqual(decideReach({ ...stale, threadUserId: "639171234567" }, "whatsapp", true, now), { mode: "template", recipientId: "639171234567", skipReason: null });
    assert.equal(decideReach(base, "whatsapp", true, now).skipReason, "no_opt_in", "never wrote + no marketing yes");
    assert.deepEqual(decideReach({ ...base, marketingOptIn: true }, "whatsapp", true, now), { mode: "template", recipientId: "639171234567", skipReason: null });
    assert.equal(decideReach({ ...fresh, optedOut: true }, "messenger", true, now).skipReason, "opted_out");
  });
  it("fills each buyer's name, last item and own link", () => {
    assert.equal(fillBroadcastTemplate("Hi {name}! Gusto mo ulit ng {item}? {link} — {shop}", { name: "Ana Cruz", item: "Ube Pandesal", link: "https://k/x", shop: "P45" }), "Hi Ana! Gusto mo ulit ng Ube Pandesal? https://k/x — P45");
    assert.equal(fillBroadcastTemplate("Hi {name}! {item}", { name: null, item: null, link: "", shop: "" }), "Hi po! your favorites");
  });

  it("queue freezes recipients with how to reach each; batches, counters, finish", async () => {
    const [ana] = await db.select().from(customers).where(sql`${customers.tenantId} = ${shop.id} and ${customers.phone} like ${"%" + phone(1).slice(-7)}`);
    assert.ok(ana, "order created the customer");
    // Ana chatted on Messenger 1 hour ago; Cora on Messenger 2 days ago.
    const t1 = await recordSocialMessage({ account: { id: ids.messenger, tenantId: shop.id, platform: "messenger" }, userId: `psid-ana-${run}`, messageId: `m-${randomUUID()}`, text: "hi", kind: "text", at: new Date() });
    await db.update(socialThreads).set({ customerId: ana!.id }).where(eq(socialThreads.id, t1.threadId));
    const [cora] = await db.select().from(customers).where(sql`${customers.tenantId} = ${shop.id} and ${customers.phone} like ${"%" + phone(3).slice(-7)}`);
    const t3 = await recordSocialMessage({ account: { id: ids.messenger, tenantId: shop.id, platform: "messenger" }, userId: `psid-cora-${run}`, messageId: `m-${randomUUID()}`, text: "hi", kind: "text", at: new Date(Date.now() - 48 * 3_600_000) });
    await db.update(socialThreads).set({ customerId: cora!.id, lastInboundAt: new Date(Date.now() - 48 * 3_600_000) }).where(eq(socialThreads.id, t3.threadId));

    const audience = await loadAudience(shop.id, "messenger", ["PAYDAY_SHOPPER"]);
    assert.equal(audience.length, 2);
    assert.ok(audience.find((a) => a.threadId === t1.threadId)?.lastOrderId, "last order found");
    assert.equal(audience.find((a) => a.threadId === t1.threadId)?.lastItem, "Ube Cheese Pandesal");
    const preview = await previewBroadcastAudience(shop.id, { channel: "messenger", segmentTags: ["PAYDAY_SHOPPER"] });
    assert.deepEqual([preview.total, preview.session, preview.skipped.outside_24h], [2, 1, 1]);

    const b = await createBroadcast(shop.id, { name: "Payday", channel: "messenger", kind: "payday", segmentTags: ["PAYDAY_SHOPPER"], messageTemplate: "Hi {name}! Payday na! {link}", rateLimitPerSec: 50 }, "Owner");
    assert.equal(b.rateLimitPerSec, 10, "capped at the 10 msg/s plan limit");
    const q = await queueBroadcast(shop.id, b.id, null);
    assert.deepEqual([q.status, q.recipients, q.skipped], ["scheduled", 2, 1]);
    await assert.rejects(queueBroadcast(shop.id, b.id, null), /already scheduled/);

    const batches = await claimBroadcastBatches(new Date(Date.now() + 1000));
    const mine = batches.find((x) => x.campaign.id === b.id)!;
    assert.equal(mine.recipients.length, 1);
    assert.equal(mine.recipients[0]!.mode, "session");
    assert.equal(mine.recipients[0]!.threadId, t1.threadId);
    assert.equal(mine.campaign.shopSlug, shop.slug);
    await recordBroadcastSend(mine.recipients[0]!.id, b.id, { status: "sent", body: "Hi Ana!" });
    await recordBroadcastSend(mine.recipients[0]!.id, b.id, { status: "sent", body: "dup" }); // idempotent
    assert.ok(await finishBroadcastIfDone(b.id));
    const done = await getBroadcast(shop.id, b.id);
    assert.deepEqual([done!.status, done!.sent, done!.skipped], ["sent", 1, 1]);

    const empty = await createBroadcast(shop.id, { name: "IG", channel: "instagram", kind: "custom", segmentTags: [], messageTemplate: "Hello {link}" }, "Owner");
    await assert.rejects(queueBroadcast(shop.id, empty.id, null), /last 24 hours/);
    assert.equal((await cancelBroadcast(shop.id, empty.id)).status, "cancelled");
    await assert.rejects(createBroadcast(shop.id, { name: "R", channel: "messenger", kind: "restock", segmentTags: [], messageTemplate: "back {link}" }, "x"), /Pick the product/);
  });

  it("reorder link: same still-for-sale items, one live link per order, no buyer details", async () => {
    const oid = await order(phone(9), "Dina", new Date(), { qty: 3 });
    const l1 = await createReorderLink(shop.slug, oid);
    const l2 = await createReorderLink(shop.slug, oid);
    assert.ok(l1 && l2);
    assert.equal(l1.code, l2.code);
    const [link] = await db.select().from(checkoutLinks).where(eq(checkoutLinks.code, l1.code));
    assert.equal(link!.origin, "reorder");
    assert.equal(link!.prefillJson, null);
    const items = await db.select().from(checkoutLinkItems).where(eq(checkoutLinkItems.linkId, link!.id));
    assert.deepEqual(items.map((i) => i.quantity), [3]);
    assert.equal(await createReorderLink("wrong-shop", oid), null);
    const oldOnly = await order(phone(9), "Dina", new Date(), { productId: ids.product2 }).catch(() => null);
    if (oldOnly) assert.equal(await createReorderLink(shop.slug, oldOnly), null, "archived products aren't re-sold");
  });
});

describe("4.3 BayanGo review loop", () => {
  it("2 h after delivery → ask in the buyer's chat → stars publish a verified review + single-use voucher", async () => {
    await saveAiSuiteSettings(shop.id, { reviewVoucherAmount: 50, reviewVoucherDays: 30 });
    const oid = await order(phone(5), "Eli Santos", new Date(Date.now() - 3 * 3_600_000));
    const t = await recordSocialMessage({ account: { id: ids.whatsapp, tenantId: shop.id, platform: "whatsapp" }, userId: `6391755${phone(5).slice(-5)}`, messageId: `w-${randomUUID()}`, text: "salamat", kind: "text", at: new Date() });
    await db.update(socialThreads).set({ externalUserId: `63${phone(5).slice(-10)}` }).where(eq(socialThreads.id, t.threadId));
    const deliveredAt = new Date(Date.now() - 2.5 * 3_600_000);
    assert.equal(await scheduleReviewPrompt({ orderId: oid, tenantId: shop.id, deliveredAt }), true);
    assert.equal(await scheduleReviewPrompt({ orderId: oid, tenantId: shop.id, deliveredAt }), false, "BayanGo retries are harmless");
    assert.equal((await listDueReviewPrompts(new Date(deliveredAt.getTime() + 3_600_000))).some((p) => p.orderId === oid), false, "not before 2 h");
    const due = (await listDueReviewPrompts()).find((p) => p.orderId === oid)!;
    assert.ok(due);
    assert.equal(due.thread?.id, t.threadId, "matched the buyer's WhatsApp chat by phone");
    await markReviewPrompt(due.id, { status: "sent", threadId: t.threadId, channel: "whatsapp" });
    const open = await findOpenReviewPrompt(shop.id, t.threadId);
    assert.equal(open?.id, due.id);

    // Not delivered yet → not eligible (and the prompt closes).
    const early = await completeReviewFromChat(shop.id, due.id, { rating: 5 }).catch((e) => e);
    assert.equal(early.status, "not_eligible");
    // Deliver it and ask again.
    await db.update(reviewPrompts).set({ status: "sent", skipReason: null }).where(eq(reviewPrompts.id, due.id));
    await db.execute(sql`update orders set fulfillment_state = 'delivered' where id = ${oid}`);
    const done = await completeReviewFromChat(shop.id, due.id, { rating: 5, body: "sobrang sarap!", photos: ["https://media.guma.one/r/1.jpg"] });
    assert.equal(done.status, "reviewed");
    assert.equal(done.reviewIds.length, 1);
    const [rv] = await db.select().from(productReviews).where(eq(productReviews.id, done.reviewIds[0]!));
    assert.deepEqual([rv!.rating, rv!.status, rv!.body, rv!.photosJson, rv!.buyerName], [5, "published", "sobrang sarap!", ["https://media.guma.one/r/1.jpg"], "Eli S."]);
    assert.equal(done.voucher?.amount, 50);
    assert.equal((await completeReviewFromChat(shop.id, due.id, { rating: 1 })).status, "already");

    // The voucher is single-use: a ₱30 order spends it; the ₱20 left is forfeited.
    const [card] = await db.select().from(giftCards).where(eq(giftCards.code, done.voucher!.code));
    assert.equal(card!.singleUse, true);
    const spend = await db.transaction((tx) => redeemGiftCardInTx(tx, { tenantId: shop.id, code: card!.code, maxAmount: 30, orderId: oid, actorName: "test" }));
    assert.deepEqual([spend.amount, spend.balanceAfter], [30, 0]);
    const [after] = await db.select({ balance: giftCards.balance }).from(giftCards).where(eq(giftCards.id, card!.id));
    assert.equal(Number(after!.balance), 0);
  });
});

describe("5.1 Printair milestones", () => {
  it("highest order milestone only; first studio campaign; rendering → ready → card → dismiss", async () => {
    assert.equal(orderMilestoneFor(9), null);
    assert.equal(orderMilestoneFor(10), "orders_10");
    assert.equal(orderMilestoneFor(120), "orders_100");
    assert.equal(orderMilestoneFor(500), "orders_500");
    // 10 completed orders
    await db.execute(sql`update orders set order_state = 'completed' where tenant_id = ${shop.id}`);
    const count = (await db.execute(sql`select count(*)::int as n from orders where tenant_id = ${shop.id}`)) as unknown as Array<{ n: number }>;
    for (let i = count[0]!.n; i < 10; i++) {
      const id = await order(phone(20 + i), `Buyer ${i}`, new Date());
      await db.execute(sql`update orders set order_state = 'completed' where id = ${id}`);
    }
    const mine = (await listPrintairCandidates(5000)).find((c) => c.tenantId === shop.id);
    assert.equal(mine?.milestone, "orders_10");
    const job = await enqueueAiMediaJob({ tenantId: shop.id, jobType: "printair_mockup", inputPayload: { shopName: "P45", storeUrl: "https://kart.guma.one/x" }, idempotencyKey: "printair:orders_10" });
    assert.ok(job.ok);
    assert.equal(await createPrintairUpsell(shop.id, "orders_10", job.job.id), true);
    assert.equal(await createPrintairUpsell(shop.id, "orders_10", job.job.id), false);
    assert.ok(!(await listPrintairCandidates(5000)).some((c) => c.tenantId === shop.id && c.milestone === "orders_10"));
    assert.equal(await getActivePrintairCard(shop.id), null, "still rendering");
    await db.update(aiMediaJobs).set({ status: "completed", completedAt: new Date(), outputUrls: [{ url: "https://m/1.png", kind: "image", contentType: "image/png", variant: "mockup:thank_you_card" }] }).where(eq(aiMediaJobs.id, job.job.id));
    assert.ok((await syncPrintairUpsells()) >= 1);
    const card = await getActivePrintairCard(shop.id);
    assert.equal(card?.milestone, "orders_10");
    assert.equal(card?.outputs[0]?.variant, "mockup:thank_you_card");
    assert.ok(await setPrintairCardStatus(shop.id, card!.id, "handoff"));
    assert.ok(await setPrintairCardStatus(shop.id, card!.id, "dismiss"));
    assert.equal(await getActivePrintairCard(shop.id), null);
  });
});

void orders;
