/**
 * Phase 14 — reports, discounts (deals, once per buyer), segments and SMS campaigns
 * (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { addOptOut } from "./queries/message-log";
import { OrderError } from "./queries/order-status";
import { createOrderForTenant } from "./queries/orders";
import { applyStockChanges, planInventoryCsvImport } from "./queries/inventory";
import { getRepeatCohorts, getSalesReport, getStockValue, reportCsv } from "./queries/reports";
import { getDiscountSettings, saveDiscountSettings } from "./queries/discounts";
import {
  campaignTag,
  cancelCampaign,
  CampaignError,
  claimCampaignBatches,
  createCampaign,
  finishCampaignIfDone,
  listCampaigns,
  previewSegment,
  queueCampaign,
  recordCampaignSend,
} from "./queries/campaigns";
import {
  customers,
  domainEvents,
  locations,
  messagingOptOuts,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  smsCampaigns,
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
const shop = { id: "", slug: `test-grow-${run}` };
const ids = { shirt: "", shirtVar: "", cap: "", capVar: "" };
const phones = { ana: `0917${run.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`, ben: "", cara: "" };
phones.ben = `0918${phones.ana.slice(4)}`;
phones.cara = `0919${phones.ana.slice(4)}`;

const buy = (phone: string, name: string, items: Array<{ productId: string; quantity: number }>, extra: Partial<Parameters<typeof createOrderForTenant>[0]> = {}) =>
  createOrderForTenant({
    tenantSlug: shop.slug,
    items,
    customer: { name, phone },
    deliveryType: "pickup",
    paymentMethod: "cod",
    deliveryFee: 0,
    minOrderAmount: 0,
    ...extra,
  });

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "Grow Shop", status: "active" }).returning();
  shop.id = t!.id;
  const [s] = await db.insert(products).values({ tenantId: shop.id, title: "Shirt", slug: `shirt-${run}`, status: "active", basePrice: "200.00", trackInventory: true }).returning();
  const [sv] = await db.insert(productVariants).values({ productId: s!.id, title: "Default", price: "200.00", stockQty: 100, sku: `SH-${run}` }).returning();
  const [c] = await db.insert(products).values({ tenantId: shop.id, title: "Cap", slug: `cap-${run}`, status: "active", basePrice: "150.00", trackInventory: true }).returning();
  const [cv] = await db.insert(productVariants).values({ productId: c!.id, title: "Default", price: "150.00", stockQty: 10 }).returning();
  Object.assign(ids, { shirt: s!.id, shirtVar: sv!.id, cap: c!.id, capVar: cv!.id });
});

after(async () => {
  const tid = [shop.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(smsCampaigns).where(inArray(smsCampaigns.tenantId, tid));
  await db.delete(messagingOptOuts).where(inArray(messagingOptOuts.phone, Object.values(phones)));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tid));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tid));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tid));
  await db.delete(customers).where(inArray(customers.tenantId, tid));
  await db.delete(locations).where(inArray(locations.tenantId, tid));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tid));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tid));
  await db.delete(tenants).where(inArray(tenants.id, tid));
  await closeDb();
});

describe("cost price", () => {
  it("is set from the stock page / CSV and snapshotted on each sale", async () => {
    await applyStockChanges(shop.id, [{ variantId: ids.shirtVar, costPrice: 120 }], { note: "cost" });
    const plan = await planInventoryCsvImport(shop.id, `sku,cost\nSH-${run},125\n`);
    assert.equal(plan.changes[0]!.costPrice, 125);
    await applyStockChanges(shop.id, plan.changes, { note: "csv" });
    const o = await buy(phones.ana, "Ana Reyes", [{ productId: ids.shirt, quantity: 2 }], { smsMarketingConsent: true });
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    assert.equal(Number(line!.unitCost), 125);
    await assert.rejects(applyStockChanges(shop.id, [{ variantId: ids.shirtVar, costPrice: -1 }], { note: "x" }));
  });
});

describe("discounts", () => {
  it("saves deals and coupons straight to checkout; deals apply to the order; once per buyer", async () => {
    await saveDiscountSettings(shop.id, {
      coupons: [{ code: "suki", type: "fixed", value: 50, oncePerBuyer: true }],
      automaticDiscount: null,
      volumeDiscounts: [{ id: "d1", label: "3+ shirts 10% off", productIds: [ids.shirt], minQty: 3, type: "percent", value: 10 }],
    });
    const settings = await getDiscountSettings(shop.id);
    assert.equal(settings!.coupons[0]!.code, "SUKI");
    await assert.rejects(
      saveDiscountSettings(shop.id, { coupons: [{ code: "A1", type: "fixed", value: 1 }, { code: "a1", type: "fixed", value: 2 }], automaticDiscount: null, volumeDiscounts: [] }),
      /same code/
    );
    const [t] = await db.select({ pub: tenants.checkoutPublishedJson }).from(tenants).where(eq(tenants.id, shop.id));
    const checkoutConfig = t!.pub as never;
    const deal = await buy(phones.ben, "Ben Cruz", [{ productId: ids.shirt, quantity: 3 }, { productId: ids.cap, quantity: 1 }], { checkoutConfig, couponCode: "SUKI", smsMarketingConsent: true });
    // shirts 600 → 60 off; then ₱50 coupon → 110 off; 750 − 110
    assert.equal(Number(deal.discount), 110);
    assert.equal(Number(deal.total), 640);
    await assert.rejects(
      buy(`+63${phones.ben.slice(1)}`, "Ben", [{ productId: ids.cap, quantity: 1 }], { checkoutConfig, couponCode: "SUKI" }),
      (e: unknown) => e instanceof OrderError && e.code === "COUPON_LIMIT_REACHED"
    );
    const usage = (await getDiscountSettings(shop.id))!.usage.find((u) => u.code === "SUKI");
    assert.equal(usage?.orders, 1);
  });
});

describe("reports", () => {
  it("sales, profit with cost coverage, channels, products, customers, repeat buyers, stock value, CSV", async () => {
    await buy(phones.ana, "Ana Reyes", [{ productId: ids.cap, quantity: 1 }], { utmJson: { ref: "tiktok" } });
    const cancelled = await buy(phones.cara, "Cara", [{ productId: ids.cap, quantity: 1 }]);
    await db.update(orders).set({ orderState: "cancelled" }).where(eq(orders.id, cancelled.id));

    const now = new Date();
    const range = { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 60_000) };
    const r = await getSalesReport(shop.id, range);
    assert.equal(r.kpis.orders, 3, "cancelled orders don't count");
    assert.equal(r.kpis.sales, 400 + 640 + 150);
    assert.equal(r.kpis.itemsSold, 2 + 4 + 1);
    // Only shirt lines have a cost: 2 + 3 shirts × (200 − 125)
    assert.equal(r.kpis.profit, 375);
    assert.equal(r.kpis.costCoverage, Math.round((5 / 7) * 1000) / 1000);
    assert.equal(r.kpis.newCustomers, 2);
    assert.ok(r.daily.length >= 1 && r.daily.reduce((n, d) => n + d.orders, 0) === 3);
    assert.equal(r.channels.find((c) => c.channel === "tiktok")?.orders, 1);
    assert.equal(r.products[0]!.title, "Shirt");
    assert.equal(r.customers[0]!.name, "Ben Cruz");

    const cohorts = await getRepeatCohorts(shop.id);
    assert.equal(cohorts.customers, 2);
    assert.equal(cohorts.repeatRate, 0.5, "Ana came back");
    assert.equal(cohorts.cohorts.at(-1)!.within30, 1);

    const stock = await getStockValue(shop.id);
    assert.equal(stock.missingCost, 1, "caps have no cost");
    assert.ok(stock.costValue > 0 && stock.retailValue > stock.costValue);

    const csv = await reportCsv(shop.id, "orders", range);
    assert.equal(csv.split("\r\n").filter(Boolean).length, 1 + 4, "the export lists cancelled orders too, with their state");
    assert.match(await reportCsv(shop.id, "products", range), /Shirt/);
    assert.match(await reportCsv(shop.id, "customers", range), /Ana Reyes/);
  });
});

describe("segments and SMS campaigns", () => {
  it("only customers who said yes, minus opt-outs; segments filter", async () => {
    const all = await previewSegment(shop.id, { kind: "all" });
    assert.equal(all.count, 2, "Ana and Ben said yes; Cara didn't");
    assert.equal((await previewSegment(shop.id, { kind: "repeat" })).count, 1);
    assert.equal((await previewSegment(shop.id, { kind: "vip", minSpend: 600 })).count, 1);
    assert.equal((await previewSegment(shop.id, { kind: "channel", channel: "tiktok" })).count, 1);
    assert.equal((await previewSegment(shop.id, { kind: "lapsed", days: 30 })).count, 0);
    await addOptOut({ phone: phones.ben, scope: "marketing", tenantId: shop.id });
    assert.equal((await previewSegment(shop.id, { kind: "all" })).count, 1, "Ben pressed Stop");
  });

  it("queue → batches → sent once; stats and attributed orders", async () => {
    const draft = await createCampaign({ tenantId: shop.id, name: "Payday", segment: { kind: "all" }, body: "Hi {name}! 10% off this payday.", createdByName: "Tess" });
    await assert.rejects(createCampaign({ tenantId: shop.id, name: "x", segment: { kind: "all" }, body: "hi", createdByName: "T" }), (e: unknown) => e instanceof CampaignError);
    const queued = await queueCampaign(shop.id, draft.id, null);
    assert.equal(queued.status, "scheduled");
    assert.equal(queued.recipients, 1);
    await assert.rejects(queueCampaign(shop.id, draft.id, null), (e: unknown) => e instanceof CampaignError && e.code === "STATE");

    const batches = await claimCampaignBatches(new Date(Date.now() + 1000));
    const mine = batches.find((b) => b.campaign.id === draft.id)!;
    assert.equal(mine.recipients.length, 1);
    await recordCampaignSend(mine.recipients[0]!.id, draft.id, "sent");
    await recordCampaignSend(mine.recipients[0]!.id, draft.id, "sent");
    assert.equal(await finishCampaignIfDone(draft.id), true);

    await buy(phones.ana, "Ana Reyes", [{ productId: ids.cap, quantity: 1 }], { utmJson: { ref: "sms", utm_campaign: campaignTag(draft.id) } });
    const [row] = (await listCampaigns(shop.id)).filter((c) => c.id === draft.id);
    assert.equal(row!.status, "sent");
    assert.equal(row!.sent, 1, "counted once");
    assert.equal(row!.orders, 1);
    assert.equal(row!.sales, 150);

    const empty = await createCampaign({ tenantId: shop.id, name: "VIP", segment: { kind: "vip", minSpend: 100000 }, body: "Thank you for being a suki!", createdByName: "Tess" });
    await assert.rejects(queueCampaign(shop.id, empty.id, null), (e: unknown) => e instanceof CampaignError && e.code === "EMPTY");
    const later = await createCampaign({ tenantId: shop.id, name: "Later", segment: { kind: "all" }, body: "See you this weekend!", createdByName: "Tess" });
    await queueCampaign(shop.id, later.id, new Date(Date.now() + 86_400_000));
    assert.equal((await claimCampaignBatches()).some((b) => b.campaign.id === later.id), false, "not due yet");
    assert.equal((await cancelCampaign(shop.id, later.id)).status, "cancelled");
  });
});
