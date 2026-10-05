/**
 * Phase 13 — channels: attribution, Messenger/Instagram inbox, Shopee/Lazada one stock pool
 * (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { createOrderForTenant } from "./queries/orders";
import { createPosSale, ensureRegister, openShift } from "./queries/pos";
import {
  beginSocialSend,
  canReplyNow,
  ensureDemoSocialAccount,
  finishSocialSend,
  getChatProductCard,
  getSocialThread,
  InboxError,
  listSocialThreads,
  recordSocialMessage,
  setSocialThreadStatus,
  upsertSocialAccount,
} from "./queries/social-inbox";
import {
  importMarketplaceOrder,
  linkMarketplaceListing,
  listMarketplaceAccounts,
  listMarketplaceListings,
  marketplaceStockPushPlan,
  recordStockPush,
  salesByChannel,
  saveMarketplaceListings,
  upsertMarketplaceAccount,
} from "./queries/marketplaces";
import {
  customers,
  domainEvents,
  locations,
  marketplaceAccounts,
  marketplaceListings,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  registerSessions,
  registers,
  socialAccounts,
  socialMessages,
  socialThreads,
  stockMovements,
  tenants,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-chan-${run}` };
const other = { id: "", slug: `test-chan2-${run}` };
const ids = { a: "", aVar: "", b: "", bVar: "" };

async function stock(variantId: string) {
  const [v] = await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId));
  return v!.q ?? 0;
}

const order = (utm: Record<string, string> | null, extra: Partial<Parameters<typeof createOrderForTenant>[0]> = {}) =>
  createOrderForTenant({
    tenantSlug: shop.slug,
    items: [{ productId: ids.a, quantity: 1 }],
    customer: { name: "Buyer", phone: "09170001234" },
    deliveryType: "pickup",
    paymentMethod: "cod",
    deliveryFee: 0,
    minOrderAmount: 0,
    utmJson: utm,
    ...extra,
  });

before(async () => {
  for (const t of [shop, other]) {
    const [row] = await db.insert(tenants).values({ slug: t.slug, name: `Shop ${t.slug}`, status: "active" }).returning();
    t.id = row!.id;
  }
  const [a] = await db.insert(products).values({ tenantId: shop.id, title: "Soap", slug: `soap-${run}`, status: "active", basePrice: "100.00", trackInventory: true }).returning();
  const [av] = await db.insert(productVariants).values({ productId: a!.id, title: "Default", price: "100.00", stockQty: 50, sku: `SOAP-${run}` }).returning();
  const [b] = await db.insert(products).values({ tenantId: shop.id, title: "Candle", slug: `candle-${run}`, status: "active", basePrice: "80.00", trackInventory: true }).returning();
  const [bv] = await db.insert(productVariants).values({ productId: b!.id, title: "Default", price: "80.00", stockQty: 3, sku: `CANDLE-${run}` }).returning();
  Object.assign(ids, { a: a!.id, aVar: av!.id, b: b!.id, bVar: bv!.id });
});

after(async () => {
  const tid = [shop.id, other.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tid));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tid));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tid));
  await db.delete(socialMessages).where(inArray(socialMessages.tenantId, tid));
  await db.delete(socialThreads).where(inArray(socialThreads.tenantId, tid));
  await db.delete(socialAccounts).where(inArray(socialAccounts.tenantId, tid));
  await db.delete(marketplaceListings).where(inArray(marketplaceListings.tenantId, tid));
  await db.delete(marketplaceAccounts).where(inArray(marketplaceAccounts.tenantId, tid));
  await db.delete(customers).where(inArray(customers.tenantId, tid));
  await db.delete(registerSessions).where(inArray(registerSessions.tenantId, tid));
  await db.delete(registers).where(inArray(registers.tenantId, tid));
  await db.delete(locations).where(inArray(locations.tenantId, tid));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tid));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tid));
  await db.delete(tenants).where(inArray(tenants.id, tid));
  await closeDb();
});

describe("sales channel on orders", () => {
  it("ref, click ids, POS", async () => {
    const t = await order({ ref: "tiktok" });
    const f = await order({ fbclid: "abc" });
    const d = await order(null);
    const rows = await db.select({ id: orders.id, ch: orders.salesChannel }).from(orders).where(inArray(orders.id, [t.id, f.id, d.id]));
    const by = new Map(rows.map((r) => [r.id, r.ch]));
    assert.equal(by.get(t.id), "tiktok");
    assert.equal(by.get(f.id), "facebook");
    assert.equal(by.get(d.id), "direct");
    const registerId = (await ensureRegister(shop.id)).id;
    const shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 0 })).id;
    const sale = await createPosSale({ tenantId: shop.id, shiftId, staffId: null, userId: null, cashierName: "T", idempotencyKey: randomUUID().replace(/-/g, ""), items: [{ productId: ids.a, quantity: 1 }], discountType: "none", tenders: [{ method: "cash", amount: 100 }] });
    const [p] = await db.select({ ch: orders.salesChannel }).from(orders).where(eq(orders.id, sale.orderId));
    assert.equal(p!.ch, "pos");
  });
});

describe("Messenger / Instagram inbox", () => {
  let accountId = "";
  let threadId = "";

  it("a Page belongs to one shop", async () => {
    const acc = await upsertSocialAccount({ tenantId: shop.id, platform: "messenger", externalId: `page-${run}`, name: "Soap Page", pageId: `page-${run}`, accessTokenSealed: null, status: "mock" });
    accountId = acc.id;
    await assert.rejects(
      upsertSocialAccount({ tenantId: other.id, platform: "messenger", externalId: `page-${run}`, name: "Soap Page", accessTokenSealed: null }),
      (e: unknown) => e instanceof InboxError && e.code === "TAKEN"
    );
  });

  it("records messages once, counts unread, reopens on a new message", async () => {
    const account = { id: accountId, tenantId: shop.id, platform: "messenger" as const };
    const first = await recordSocialMessage({ account, userId: "psid-1", messageId: "m1", text: "Available pa po?", kind: "text", at: new Date(), buyerName: "Ana" });
    threadId = first.threadId;
    assert.equal(first.isNewThread, true);
    const repeat = await recordSocialMessage({ account, userId: "psid-1", messageId: "m1", text: "Available pa po?", kind: "text", at: new Date() });
    assert.equal(repeat.created, false);
    await recordSocialMessage({ account, userId: "psid-1", messageId: "m2", text: "Magkano shipping?", kind: "text", at: new Date() });
    let [t] = await listSocialThreads(shop.id);
    assert.equal(t!.unread, 2);
    assert.equal(t!.buyerName, "Ana");
    assert.equal(t!.canReply, true);
    await setSocialThreadStatus(shop.id, threadId, "done");
    await recordSocialMessage({ account, userId: "psid-1", messageId: "m3", text: "Hello?", kind: "text", at: new Date() });
    [t] = await listSocialThreads(shop.id, { status: "open" });
    assert.equal(t!.id, threadId, "a new message reopens a done chat");
    assert.equal((await listSocialThreads(other.id)).length, 0, "other shops never see it");
  });

  it("replies: recorded, our own echo isn't duplicated, 24-hour window enforced", async () => {
    const draft = await beginSocialSend({ tenantId: shop.id, threadId, kind: "text", body: "Yes po! ₱100", sentByName: "Tess" });
    // Meta echoes our message back before we stored its id.
    await recordSocialMessage({ account: { id: accountId, tenantId: shop.id, platform: "messenger" }, userId: "psid-1", messageId: "mid-out-1", text: "Yes po! ₱100", kind: "text", at: new Date(), echo: true });
    await finishSocialSend(shop.id, threadId, draft.messageId, { success: true, externalMessageId: "mid-out-1" }, "Yes po! ₱100");
    const detail = await getSocialThread(shop.id, threadId);
    assert.equal(detail!.messages.filter((m) => m.direction === "out").length, 1);
    assert.equal(detail!.unread, 0);
    // An echo of a message typed in Meta's own inbox is recorded as outgoing.
    await recordSocialMessage({ account: { id: accountId, tenantId: shop.id, platform: "messenger" }, userId: "psid-1", messageId: "mid-meta-2", text: "From Business Suite", kind: "text", at: new Date(Date.now() + 1000), echo: true });
    assert.equal((await getSocialThread(shop.id, threadId))!.messages.filter((m) => m.direction === "out").length, 2);
    assert.equal(canReplyNow(new Date(Date.now() - 25 * 3_600_000)), false);
    await db.update(socialThreads).set({ lastInboundAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(socialThreads.id, threadId));
    await assert.rejects(beginSocialSend({ tenantId: shop.id, threadId, kind: "text", body: "hi", sentByName: "T" }), (e: unknown) => e instanceof InboxError && e.code === "WINDOW_CLOSED");
    await assert.rejects(beginSocialSend({ tenantId: other.id, threadId, kind: "text", body: "hi", sentByName: "T" }), (e: unknown) => e instanceof InboxError && e.code === "NOT_FOUND");
  });

  it("an order from a link sent in the chat is tagged to it (only for this shop's chats)", async () => {
    const o = await order({ ref: "messenger", th: threadId });
    const [row] = await db.select({ th: orders.socialThreadId, ch: orders.salesChannel }).from(orders).where(eq(orders.id, o.id));
    assert.equal(row!.th, threadId);
    assert.equal(row!.ch, "messenger");
    const detail = await getSocialThread(shop.id, threadId);
    assert.equal(detail!.linkedOrders.length, 1);
    assert.equal((await listSocialThreads(shop.id, { status: "all" }))[0]!.orders, 1, "order count per chat");
    const demo = await ensureDemoSocialAccount(other.id, "Other");
    assert.equal(demo.status, "mock");
    const card = await getChatProductCard(shop.id, ids.a);
    assert.equal(card!.price, 100);
    assert.equal(await getChatProductCard(other.id, ids.a), null);
  });
});

describe("Shopee / Lazada — one stock pool", () => {
  let accountId = "";
  const account = () => ({ id: accountId, platform: "shopee" as const });

  it("listings auto-link by SKU; stock push plan only for linked, changed listings", async () => {
    accountId = await upsertMarketplaceAccount({ tenantId: shop.id, platform: "shopee", shopExternalId: `shp-${run}`, name: "Shopee", tokensSealed: null, status: "mock" });
    const saved = await saveMarketplaceListings(shop.id, accountId, [
      { externalItemId: "1001", externalModelId: "", sku: `soap-${run}`, title: "Soap (Shopee)", price: 110, stock: 99 },
      { externalItemId: "1002", externalModelId: "", sku: `CANDLE-${run}`, title: "Candle (Shopee)", price: 90, stock: 99 },
      { externalItemId: "1003", externalModelId: "", sku: "UNKNOWN", title: "Mystery", price: 10, stock: 5 },
    ]);
    assert.equal(saved.autoLinked, 2);
    const [acct] = await listMarketplaceAccounts(shop.id);
    assert.deepEqual([acct!.listings, acct!.linked], [3, 2]);
    let plan = await marketplaceStockPushPlan(shop.id, accountId);
    assert.equal(plan.length, 2);
    await recordStockPush(shop.id, accountId, plan.map((p) => ({ listingId: p.listingId, stock: p.stock })));
    plan = await marketplaceStockPushPlan(shop.id, accountId);
    assert.equal(plan.length, 0, "nothing to push when counts match");
    await order(null, { items: [{ productId: ids.b, quantity: 1 }] });
    plan = await marketplaceStockPushPlan(shop.id, accountId);
    assert.deepEqual(plan.map((p) => p.stock), [2], "a sale here changes the marketplace count");
  });

  it("imports a paid order once, takes stock, waits for unlinked items, restocks once on cancel", async () => {
    const before = await stock(ids.bVar);
    const base = { status: "to_ship" as const, buyerName: "shopee_buyer", createdAt: new Date(), total: 180 };
    const r = await importMarketplaceOrder(shop.id, account(), { ...base, externalOrderId: `SO-${run}`, items: [{ externalItemId: "1002", externalModelId: "", sku: null, title: "Candle", quantity: 1, unitPrice: 90 }] });
    assert.equal(r.status, "imported");
    assert.equal(await stock(ids.bVar), before - 1);
    const again = await importMarketplaceOrder(shop.id, account(), { ...base, externalOrderId: `SO-${run}`, items: [{ externalItemId: "1002", externalModelId: "", sku: null, title: "Candle", quantity: 1, unitPrice: 90 }] });
    assert.equal(again.status, "duplicate");
    const [o] = await db.select().from(orders).where(eq(orders.externalOrderId, `SO-${run}`));
    assert.equal(o!.salesChannel, "shopee");
    assert.equal(o!.sourceChannel, "marketplace");
    assert.equal(o!.orderState, "completed");

    const unlinked = await importMarketplaceOrder(shop.id, account(), { ...base, externalOrderId: `SO2-${run}`, items: [{ externalItemId: "1003", externalModelId: "", sku: "UNKNOWN", title: "Mystery", quantity: 1, unitPrice: 10 }] });
    assert.equal(unlinked.status, "unlinked");
    assert.equal((await importMarketplaceOrder(shop.id, account(), { ...base, status: "unpaid", externalOrderId: `SO3-${run}`, items: [] })).status, "skipped_unpaid");

    const cancel = await importMarketplaceOrder(shop.id, account(), { ...base, status: "cancelled", externalOrderId: `SO-${run}`, items: [] });
    assert.equal(cancel.status, "cancelled");
    assert.equal(await stock(ids.bVar), before);
    const cancelAgain = await importMarketplaceOrder(shop.id, account(), { ...base, status: "cancelled", externalOrderId: `SO-${run}`, items: [] });
    assert.equal(cancelAgain.status, "duplicate");
    assert.equal(await stock(ids.bVar), before, "restocked once");
  });

  it("oversold marketplace orders never go below zero and say so", async () => {
    const have = await stock(ids.bVar);
    const r = await importMarketplaceOrder(shop.id, account(), {
      externalOrderId: `SO4-${run}`,
      status: "to_ship",
      buyerName: null,
      createdAt: new Date(),
      total: 900,
      items: [{ externalItemId: "1002", externalModelId: "", sku: null, title: "Candle", quantity: have + 2, unitPrice: 90 }],
    });
    assert.equal(r.status, "imported");
    assert.equal(await stock(ids.bVar), 0);
    assert.deepEqual(r.status === "imported" ? r.short.map((s) => s.short) : [], [2]);
  });

  it("linking is checked against the shop's own products; sales by channel adds up", async () => {
    const listing = (await listMarketplaceListings(shop.id, accountId)).find((l) => l.title === "Mystery")!;
    const [foreign] = await db.insert(products).values({ tenantId: other.id, title: "X", slug: `x-${run}`, status: "active", basePrice: "1.00" }).returning();
    const [fv] = await db.insert(productVariants).values({ productId: foreign!.id, title: "Default", price: "1.00" }).returning();
    await assert.rejects(linkMarketplaceListing(shop.id, listing.id, fv!.id));
    assert.equal(await linkMarketplaceListing(shop.id, listing.id, ids.aVar), true);
    const rows = await salesByChannel(shop.id, 30);
    const by = new Map(rows.map((r) => [r.channel, r]));
    assert.equal(by.get("tiktok")?.orders, 1);
    assert.equal(by.get("shopee")?.orders, 1, "the cancelled Shopee order isn't counted");
    assert.ok(by.get("pos"));
    assert.ok(by.get("messenger"));
  });
});
