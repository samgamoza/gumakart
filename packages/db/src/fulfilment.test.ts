/**
 * Phase 24 — in-store barcodes and parcel waybills (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, deliveries, domainEvents, getDb, orderItems, orderStatusHistory, orders, products, productVariants, tenants } from "./index";
import { assignMissingBarcodes } from "./queries/inventory";
import { upsertManualDeliveryForOrder } from "./queries/deliveries";
import { getOrderForTracking } from "./queries/orders";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 6);
const slug = `test-ful-${run}`;
let tenantId = "";
const V: string[] = [];
let orderId = "";
const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

before(async () => {
  const [t] = await db.insert(tenants).values({ slug, name: "Fulfil Shop", status: "active" }).returning();
  tenantId = t!.id;
  const [p] = await db.insert(products).values({ tenantId, title: "Tote", slug: `tote-${run}`, status: "active", basePrice: "100" }).returning();
  for (const [title, barcode] of [["Default", null], ["Kept", "4006381333931"]] as const) {
    const [v] = await db.insert(productVariants).values({ productId: p!.id, title, price: "100", stockQty: 3, barcode }).returning();
    V.push(v!.id);
  }
  const [o] = await db
    .insert(orders)
    .values({ tenantId, orderNumber: `FUL-${run}`, status: "paid", paymentStatus: "paid", paymentState: "paid", paymentMethod: "gcash", subtotal: "100", total: "100", accessToken: token, deliveryType: "delivery" } as typeof orders.$inferInsert)
    .returning();
  orderId = o!.id;
});

after(async () => {
  await db.delete(deliveries).where(eq(deliveries.orderId, orderId));
  await db.delete(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId));
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  await db.delete(domainEvents).where(eq(domainEvents.tenantId, tenantId));
  await db.delete(orders).where(eq(orders.tenantId, tenantId));
  await db.delete(productVariants).where(inArray(productVariants.id, V));
  await db.delete(products).where(eq(products.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("in-store barcodes", () => {
  it("fills only missing ones, with a valid in-store EAN-13, once", async () => {
    assert.equal(await assignMissingBarcodes(tenantId), 1);
    const rows = await db.select().from(productVariants).where(inArray(productVariants.id, V));
    const made = rows.find((r) => r.title === "Default")!.barcode!;
    assert.match(made, /^2\d{12}$/);
    const sum = [...made.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    assert.equal((10 - (sum % 10)) % 10, Number(made[12]), "check digit");
    assert.equal(rows.find((r) => r.title === "Kept")!.barcode, "4006381333931", "existing barcode untouched");
    assert.equal(await assignMissingBarcodes(tenantId), 0);
  });
});

describe("parcel waybills", () => {
  it("a tracking number with no rider details shows on the buyer's order page", async () => {
    await upsertManualDeliveryForOrder({ orderId, courierLabel: "J&T Express", courierName: "J&T Express", trackingNumber: "JT7788990011" });
    const view = await getOrderForTracking(slug, `FUL-${run}`, token);
    assert.equal(view?.delivery?.trackingNumber, "JT7788990011");
    assert.equal(view?.delivery?.courierName, "J&T Express");
    assert.equal(view?.delivery?.driverName, null);
    assert.equal(view?.fulfillmentState, "booked");
  });
});
