/**
 * Phase 15 — API keys, public API read models, DB-trigger webhook events, fan-out, delivery
 * retries and auto-disable (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { applyOrderAction } from "./queries/order-lifecycle";
import { createOrderForTenant } from "./queries/orders";
import {
  ApiInputError,
  apiGetOrder,
  apiListCustomers,
  apiListInventory,
  apiListOrders,
  apiListProducts,
  apiSetStock,
} from "./queries/public-api";
import {
  authenticateApiToken,
  claimDueDeliveries,
  createApiToken,
  createTestDelivery,
  createWebhookEndpoint,
  fanOutWebhookEvents,
  listApiTokens,
  listWebhookDeliveries,
  listWebhookEndpoints,
  recordDeliveryResult,
  redeliverWebhook,
  revokeApiToken,
  updateWebhookEndpoint,
  PlatformError,
} from "./queries/developer";
import { WEBHOOK_DISABLE_AFTER, decodeCursor, hasScope } from "./types/developer";
import {
  apiTokens,
  domainEvents,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  stockMovements,
  customers,
  tenants,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-dev-${run}` };
const other = { id: "", slug: `test-dev2-${run}` };
const ids = { mug: "", mugVar: "" };
const digits = run.replace(/\D/g, "").padEnd(7, "3").slice(0, 7);

const buy = (phone: string, name: string, qty = 1, slug = shop.slug, productId = ids.mug) =>
  createOrderForTenant({
    tenantSlug: slug,
    items: [{ productId, quantity: qty }],
    customer: { name, phone },
    deliveryType: "delivery",
    deliveryAddress: { line1: "12 Mabini St", barangay: "Poblacion", city: "Lipa", province: "Batangas" },
    paymentMethod: "cod",
    deliveryFee: 50,
    minOrderAmount: 0,
  });

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "Dev Shop", status: "active" }).returning();
  const [t2] = await db.insert(tenants).values({ slug: other.slug, name: "Other Shop", status: "active" }).returning();
  shop.id = t!.id;
  other.id = t2!.id;
  const [p] = await db.insert(products).values({ tenantId: shop.id, title: "Mug", slug: `mug-${run}`, status: "active", basePrice: "250.00", trackInventory: true }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "250.00", stockQty: 40, sku: `MUG-${run}` }).returning();
  Object.assign(ids, { mug: p!.id, mugVar: v!.id });
});

after(async () => {
  const tid = [shop.id, other.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.tenantId, tid));
  await db.delete(webhookEvents).where(inArray(webhookEvents.tenantId, tid));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tid));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tid));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tid));
  await db.delete(customers).where(inArray(customers.tenantId, tid));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tid));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tid));
  await db.delete(tenants).where(inArray(tenants.id, tid));
  await closeDb();
});

describe("API keys", () => {
  it("are shown once, stored hashed, scoped, and stop working when revoked", async () => {
    const { token, row } = await createApiToken({ tenantId: shop.id, name: "Sheets sync", scopes: ["orders:write", "bogus"], createdByName: "Tess" });
    assert.match(token, /^gk_live_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(row.scopes, ["orders:read", "orders:write"], "write brings read; unknown scopes dropped");
    assert.equal(row.prefix, token.slice(0, 14));
    const stored = await db.select().from(apiTokens).where(eq(apiTokens.id, row.id));
    assert.notEqual(stored[0]!.tokenHash, token);
    assert.equal(stored[0]!.tokenHash.length, 64);

    const p = await authenticateApiToken(token);
    assert.equal(p?.tenantId, shop.id);
    assert.equal(p?.tenantSlug, shop.slug);
    assert.ok(p && hasScope(p.scopes, "orders:read") && !hasScope(p.scopes, "customers:read"));
    assert.equal(await authenticateApiToken(`${token}x`), null);
    assert.equal(await authenticateApiToken("Bearer nope"), null);

    await revokeApiToken(shop.id, row.id);
    assert.equal(await authenticateApiToken(token), null);
    await assert.rejects(revokeApiToken(other.id, row.id), PlatformError, "another shop can't revoke it");
    assert.equal((await listApiTokens(shop.id)).length, 1);

    const expired = await createApiToken({ tenantId: shop.id, name: "Old", scopes: ["products:read"], expiresInDays: 30, createdByName: "Tess", now: new Date(Date.now() - 31 * 86_400_000) });
    assert.equal(await authenticateApiToken(expired.token), null, "expired");
  });
});

describe("public API read models", () => {
  it("lists orders newest first with cursors, scoped to the shop, money as 2-decimal strings", async () => {
    const a = await buy(`0917${digits}`, "Ana Cruz");
    const b = await buy(`0918${digits}`, "Ben Cruz", 2);
    const c = await buy(`0919${digits}`, "Cara Cruz");
    const first = await apiListOrders(shop.id, { limit: 2, cursor: null });
    assert.deepEqual(first.data.map((o) => o.id), [c.id, b.id]);
    assert.ok(first.next_cursor);
    const second = await apiListOrders(shop.id, { limit: 2, cursor: decodeCursor(first.next_cursor) });
    assert.deepEqual(second.data.map((o) => o.id), [a.id]);
    assert.equal(second.next_cursor, null);

    const one = await apiGetOrder(shop.id, b.orderNumber);
    assert.equal(one?.id, b.id);
    assert.equal(one?.total, "550.00");
    assert.equal(one?.items[0]?.quantity, 2);
    assert.equal(one?.items[0]?.sku, `MUG-${run}`);
    assert.equal(one?.shipping_address?.city, "Lipa");
    assert.equal(one?.buyer.name, "Ben Cruz");
    assert.equal(await apiGetOrder(other.id, b.id), null, "other shops can't see it");

    const unpaid = await apiListOrders(shop.id, { limit: 50, cursor: null, paymentState: "paid" });
    assert.equal(unpaid.data.length, 0);
  });

  it("products, inventory and customers", async () => {
    const prods = await apiListProducts(shop.id, { limit: 10, cursor: null });
    assert.equal(prods.data[0]?.variants[0]?.sku, `MUG-${run}`);
    const stock = await apiListInventory(shop.id, { limit: 10, sku: `MUG-${run}` });
    assert.equal(stock.data.length, 1);
    assert.equal(stock.data[0]?.product_title, "Mug");
    const cust = await apiListCustomers(shop.id, { limit: 10, cursor: null, phone: `+63918${digits}` });
    assert.equal(cust.data.length, 1);
    assert.equal(cust.data[0]?.orders_count, 1);
    assert.equal(cust.data[0]?.total_spent, "550.00");
  });

  it("sets stock by SKU, all or nothing", async () => {
    const res = await apiSetStock(shop.id, [{ sku: `MUG-${run}`, stock: 25 }], { note: "API: test" });
    assert.equal(res.changed, 1);
    assert.equal(res.variants[0]?.stock, 25);
    await assert.rejects(
      apiSetStock(shop.id, [{ sku: `MUG-${run}`, stock: 30 }, { sku: "NOPE", stock: 1 }], { note: "x" }),
      (e: unknown) => e instanceof ApiInputError && e.details?.[0]?.index === 1
    );
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, ids.mugVar));
    assert.equal(v!.stockQty, 25, "nothing written on error");
    const [otherVariantProduct] = await db.insert(products).values({ tenantId: other.id, title: "X", slug: `x-${run}`, status: "active", basePrice: "1.00" }).returning();
    const [ov] = await db.insert(productVariants).values({ productId: otherVariantProduct!.id, title: "Default", price: "1.00", stockQty: 1 }).returning();
    await assert.rejects(apiSetStock(shop.id, [{ variant_id: ov!.id, stock: 9 }], { note: "x" }), ApiInputError);
  });
});

describe("webhooks", () => {
  let endpointId = "";

  it("emits nothing for shops without an endpoint", async () => {
    const before = await db.select().from(webhookEvents).where(eq(webhookEvents.tenantId, shop.id));
    assert.equal(before.length, 0);
  });

  it("DB triggers write events for orders, stock and new customers in the same transaction", async () => {
    endpointId = await createWebhookEndpoint({
      tenantId: shop.id,
      url: "https://hooks.example.com/guma",
      events: ["order.created", "order.fulfillment_updated", "inventory.updated", "customer.created"],
      secretSealed: "v1.sealed",
      createdByName: "Tess",
    });
    const o = await buy(`0920${digits}`, "Dina Cruz");
    await applyOrderAction({ orderId: o.id, tenantId: shop.id, action: { type: "accept" }, source: "seller" });
    await applyOrderAction({ orderId: o.id, tenantId: shop.id, action: { type: "mark_ready" }, source: "seller" });
    const evs = await db.select().from(webhookEvents).where(eq(webhookEvents.tenantId, shop.id));
    const names = evs.map((e) => e.event).sort();
    assert.ok(names.includes("order.created"));
    assert.ok(names.includes("order.fulfillment_updated"));
    assert.ok(names.includes("inventory.updated"), "the sale moved stock");
    assert.ok(names.includes("customer.created"));
    assert.ok(!names.includes("order.paid"), "not subscribed → no event");

    const r = await fanOutWebhookEvents();
    assert.ok(r.events >= 4);
    const deliveries = await listWebhookDeliveries(shop.id, endpointId);
    assert.equal(deliveries.length, r.deliveries);
    const [created] = await db.select().from(webhookEvents).where(and(eq(webhookEvents.tenantId, shop.id), eq(webhookEvents.event, "order.created")));
    const payload = created!.payloadJson as { type: string; shop: { slug: string }; data: { object: { id: string; number: string } } };
    assert.equal(payload.type, "order.created");
    assert.equal(payload.shop.slug, shop.slug);
    assert.equal(payload.data.object.id, o.id);
    assert.equal((await fanOutWebhookEvents()).events, 0, "each event fans out once");
  });

  it("retries failures on a schedule, then succeeds and resets the streak", async () => {
    const due = await claimDueDeliveries({ limit: 100 });
    const mine = due.filter((d) => d.tenantId === shop.id);
    assert.ok(mine.length >= 4);
    assert.equal((await claimDueDeliveries({ limit: 100 })).filter((d) => d.tenantId === shop.id).length, 0, "leased");
    const first = mine[0]!;
    assert.equal(JSON.parse(first.body).shop.slug, shop.slug);
    assert.equal(await recordDeliveryResult(first, { ok: false, statusCode: 500, error: "HTTP 500", ms: 12 }), "retry");
    const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, first.id));
    assert.equal(row!.status, "pending");
    assert.equal(row!.attempts, 1);
    assert.ok(row!.nextAttemptAt! > new Date(Date.now() + 30_000), "waits about a minute");
    for (const d of mine.slice(1)) await recordDeliveryResult(d, { ok: true, statusCode: 200, error: null, ms: 8 });
    const [ep] = await listWebhookEndpoints(shop.id);
    assert.equal(ep!.consecutiveFailures, 0);
    assert.equal(ep!.stats.pending, 1);
    assert.ok(ep!.stats.succeeded24h >= 3);

    // Manual resend restarts the round.
    await redeliverWebhook(shop.id, first.id);
    const [again] = await claimDueDeliveries({ deliveryId: first.id });
    assert.equal(again?.attempts, 0);
    assert.equal(await recordDeliveryResult(again!, { ok: true, statusCode: 204, error: null, ms: 5 }), "succeeded");
  });

  it("test events don't count toward the failure streak", async () => {
    const id = await createTestDelivery(shop.id, endpointId);
    const [d] = await claimDueDeliveries({ deliveryId: id });
    assert.equal(d?.event, "webhook.test");
    assert.equal(await recordDeliveryResult(d!, { ok: false, statusCode: null, error: "down", ms: 1 }), "failed");
    const [ep] = await listWebhookEndpoints(shop.id);
    assert.equal(ep!.consecutiveFailures, 0);
  });

  it("turns an endpoint off after a long losing streak and fails its queue", async () => {
    await db.update(webhookEndpoints).set({ consecutiveFailures: WEBHOOK_DISABLE_AFTER - 1 }).where(eq(webhookEndpoints.id, endpointId));
    await apiSetStock(shop.id, [{ sku: `MUG-${run}`, stock: 26 }], { note: "x" });
    await apiSetStock(shop.id, [{ sku: `MUG-${run}`, stock: 27 }], { note: "x" });
    await fanOutWebhookEvents();
    const due = (await claimDueDeliveries({ limit: 100 })).filter((d) => d.tenantId === shop.id);
    assert.equal(due.length, 2);
    await recordDeliveryResult(due[0]!, { ok: false, statusCode: 404, error: "HTTP 404", ms: 3 });
    const [ep] = await listWebhookEndpoints(shop.id);
    assert.equal(ep!.active, false);
    assert.match(ep!.disabledReason ?? "", /Turned off/);
    const [other] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, due[1]!.id));
    assert.equal(other!.status, "failed");

    // Off → no new events; back on → streak reset.
    await apiSetStock(shop.id, [{ sku: `MUG-${run}`, stock: 28 }], { note: "x" });
    assert.equal((await fanOutWebhookEvents()).events, 0);
    await updateWebhookEndpoint(shop.id, endpointId, { active: true });
    const [on] = await listWebhookEndpoints(shop.id);
    assert.equal(on!.active, true);
    assert.equal(on!.consecutiveFailures, 0);
    await assert.rejects(updateWebhookEndpoint(other.id, endpointId, { active: false }), PlatformError);
  });
});
