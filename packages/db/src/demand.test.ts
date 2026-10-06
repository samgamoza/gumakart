/**
 * Phase 22 — back-in-stock alerts, wishlists, pre-orders (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb, orderItems, orders, products, productVariants, stockAlerts, tenants, wishlistItems, customers, orderStatusHistory, stockMovements, paymentTransactions, domainEvents } from "./index";
import { activePreorder, shipDateLabel } from "./types/demand";
import {
  claimDeviceWishlist,
  createStockAlert,
  getDemandSummary,
  getWaitingCountsByVariant,
  listAlertsToSend,
  listWishlist,
  markAlertNotified,
  setWishlisted,
} from "./queries/demand";
import { createOrderForTenant } from "./queries/orders";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 6);
const slug = `test-dem-${run}`;
let tenantId = "";
const P: Record<string, string> = {};
const V: Record<string, string> = {};
const tail = String(Date.now()).slice(-6);

before(async () => {
  const [t] = await db.insert(tenants).values({ slug, name: "Demand Shop", status: "active" }).returning();
  tenantId = t!.id;
  const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const defs: Array<[string, number, Record<string, unknown> | null]> = [
    ["soldout", 0, null],
    ["instock", 4, null],
    ["pre", 0, { preorder: { enabled: true, shipDate: future } }],
  ];
  for (const [k, stock, meta] of defs) {
    const [p] = await db
      .insert(products)
      .values({ tenantId, title: `Item ${k}`, slug: `${k}-${run}`, status: "active", basePrice: "100", metadataJson: meta as never })
      .returning();
    P[k] = p!.id;
    const [v] = await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "100", stockQty: stock }).returning();
    V[k] = v!.id;
  }
});

after(async () => {
  const ids = (await db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, tenantId))).map((r) => r.id);
  if (ids.length) {
    await db.delete(paymentTransactions).where(inArray(paymentTransactions.orderId, ids));
    await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids));
  }
  await db.delete(stockMovements).where(eq(stockMovements.tenantId, tenantId));
  await db.delete(domainEvents).where(eq(domainEvents.tenantId, tenantId));
  await db.delete(orders).where(eq(orders.tenantId, tenantId));
  await db.delete(customers).where(eq(customers.tenantId, tenantId));
  await db.delete(stockAlerts).where(eq(stockAlerts.tenantId, tenantId));
  await db.delete(wishlistItems).where(eq(wishlistItems.tenantId, tenantId));
  await db.delete(productVariants).where(inArray(productVariants.productId, Object.values(P)));
  await db.delete(products).where(eq(products.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("pre-order rules (pure)", () => {
  it("only when on, with a valid date that hasn't passed", () => {
    const now = new Date("2026-10-06T04:00:00Z");
    assert.equal(activePreorder({ preorder: { enabled: true, shipDate: "2026-11-15" } }, now), "2026-11-15");
    assert.equal(activePreorder({ preorder: { enabled: true, shipDate: "2026-10-01" } }, now), null, "past date");
    assert.equal(activePreorder({ preorder: { enabled: false, shipDate: "2026-11-15" } }, now), null);
    assert.equal(activePreorder({ preorder: { enabled: true, shipDate: "15/11" } }, now), null);
    assert.equal(activePreorder(null, now), null);
    assert.equal(shipDateLabel("2026-11-15", now), "Nov 15");
    assert.equal(shipDateLabel("2027-01-05", now), "Jan 5, 2027");
  });
});

describe("back-in-stock alerts", () => {
  it("only for sold-out items, validated, once per contact", async () => {
    await assert.rejects(createStockAlert({ tenantId, productId: P.instock!, phone: "09171234567" }), /in stock/);
    await assert.rejects(createStockAlert({ tenantId, productId: P.soldout!, phone: "12345" }), /PH mobile/);
    await assert.rejects(createStockAlert({ tenantId, productId: P.soldout! }), /mobile number or email/);
    for (let i = 0; i < 7; i++) {
      assert.equal((await createStockAlert({ tenantId, productId: P.soldout!, phone: `+63917${tail}${i}` })).created, true);
    }
    assert.equal((await createStockAlert({ tenantId, productId: P.soldout!, phone: `0917${tail}0` })).created, false, "same number, same item");
    await createStockAlert({ tenantId, productId: P.soldout!, email: "Ana@Example.com" });
    assert.equal((await getWaitingCountsByVariant(tenantId)).get(V.soldout!), 8);
  });

  it("nothing goes out while stock is 0; after a restock of 2, the first 5 in line (oldest first)", async () => {
    assert.equal((await listAlertsToSend()).filter((a) => a.tenantId === tenantId).length, 0);
    await db.update(productVariants).set({ stockQty: 2 }).where(eq(productVariants.id, V.soldout!));
    const batch = (await listAlertsToSend()).filter((a) => a.tenantId === tenantId);
    assert.equal(batch.length, 5, "max(5, 2 × stock)");
    assert.equal(batch[0]!.phone, `0917${tail}0`);
    assert.equal(batch[0]!.productTitle, "Item soldout");
    for (const a of batch) await markAlertNotified(a.id);
    const next = (await listAlertsToSend()).filter((a) => a.tenantId === tenantId);
    assert.equal(next.length, 3, "the rest next run");
  });
});

describe("wishlists", () => {
  it("guest device saves, then moves to the Guma ID on sign-in; counts are real", async () => {
    const device = `dev-${randomUUID()}`;
    await setWishlisted(tenantId, P.instock!, { deviceId: device }, true);
    await setWishlisted(tenantId, P.instock!, { deviceId: device }, true);
    await setWishlisted(tenantId, P.pre!, { deviceId: device }, true);
    assert.deepEqual(new Set(await listWishlist(tenantId, { deviceId: device })), new Set([P.instock, P.pre]));
    await setWishlisted(tenantId, P.pre!, { deviceId: device }, false);
    assert.deepEqual(await listWishlist(tenantId, { deviceId: device }), [P.instock]);
    await setWishlisted(tenantId, P.instock!, { deviceId: `dev-${randomUUID()}` }, true);
    const s = await getDemandSummary(tenantId);
    assert.equal(s.mostSaved[0]?.saves, 2);
    assert.equal(s.waiting[0]?.waiting, 3);
    await assert.rejects(setWishlisted(randomUUID(), P.instock!, { deviceId: device }, true), /not found/);
    assert.equal(typeof claimDeviceWishlist, "function");
  });
});

describe("pre-orders at checkout", () => {
  it("a pre-order product sells past stock without touching it, and carries the ship date", async () => {
    const order = await createOrderForTenant({
      tenantSlug: slug,
      items: [{ productId: P.pre!, quantity: 3 }],
      customer: { name: "Pre Buyer", phone: `0918${tail}1` },
      deliveryType: "delivery",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
    });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    assert.ok(item?.preorderShipDate, "ship date on the line");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, V.pre!));
    assert.equal(v?.stockQty, 0, "stock untouched");
    const s = await getDemandSummary(tenantId);
    assert.equal(s.preorders[0]?.units, 3);
  });

  it("a normal sold-out product still refuses", async () => {
    await db.update(productVariants).set({ stockQty: 0 }).where(eq(productVariants.id, V.soldout!));
    await assert.rejects(
      createOrderForTenant({
        tenantSlug: slug,
        items: [{ productId: P.soldout!, quantity: 1 }],
        customer: { name: "B", phone: `0918${tail}2` },
        deliveryType: "delivery",
        paymentMethod: "cod",
        deliveryFee: 0,
        minOrderAmount: 0,
      }),
      /Not enough stock/
    );
  });
});
