/**
 * Phase 26 — restock suggestions and advisor facts (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb, orderItems, orders, products, productVariants, tenants } from "./index";
import { getAdvisorFacts, getRestockSuggestions, restockLine } from "./queries/insights";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run against a hosted database.");

const db = getDb();
const run = randomUUID().slice(0, 8);
let tenantId = "";
const v: Record<string, string> = {};
const p: Record<string, string> = {};

async function order(lines: Array<[string, number, number?]>, extra: Partial<typeof orders.$inferInsert> = {}, daysAgo = 2) {
  const total = lines.reduce((s, [, q]) => s + q * 100, 0);
  const [o] = await db
    .insert(orders)
    .values({ tenantId, orderNumber: `INS-${run}-${randomUUID().slice(0, 6)}`, status: "paid", paymentStatus: "paid", paymentMethod: "gcash", subtotal: String(total), total: String(total), createdAt: new Date(Date.now() - daysAgo * 86_400_000), ...extra })
    .returning();
  for (const [key, qty, returned] of lines) {
    await db.insert(orderItems).values({ orderId: o!.id, productId: p[key]!, variantId: v[key]!, titleSnapshot: key, quantity: qty, unitPrice: "100.00", lineTotal: String(qty * 100), returnedQty: returned ?? 0 });
  }
  return o!.id;
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: `test-ins-${run}`, name: "Insight Shop", status: "active" }).returning();
  tenantId = t!.id;
  for (const [key, stock, status] of [["fast", 6, "active"], ["slow", 50, "active"], ["out", 0, "active"], ["archived", 1, "archived"]] as const) {
    const [prod] = await db.insert(products).values({ tenantId, title: `Item ${key}`, slug: `${key}-${run}`, status, basePrice: "100.00" }).returning();
    p[key] = prod!.id;
    const [vv] = await db.insert(productVariants).values({ productId: prod!.id, title: "Default", price: "100.00", stockQty: stock }).returning();
    v[key] = vv!.id;
  }
  await order([["fast", 30], ["slow", 3]]); // fast: 30 sold / 30 days = 1/day, 6 left → 6 days
  await order([["out", 4]]);
  await order([["archived", 10]]);
  await order([["fast", 10]], { orderState: "cancelled" } as never); // cancelled — ignored
  await order([["slow", 30, 30]]); // fully returned — ignored
  await order([["fast", 90]], {}, 45); // outside the 30-day window
  await order([["slow", 1]], { paymentStatus: "pending", paymentState: "pending_verification" } as never);
});

after(async () => {
  const ids = (await db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, tenantId))).map((r) => r.id);
  if (ids.length) await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
  await db.delete(orders).where(eq(orders.tenantId, tenantId));
  await db.delete(productVariants).where(inArray(productVariants.productId, Object.values(p)));
  await db.delete(products).where(eq(products.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  await closeDb();
});

describe("restock math", () => {
  it("days left and order quantity", () => {
    assert.deepEqual(restockLine({ stock: 6, sold: 30, windowDays: 30, coverDays: 14 }), { perDay: 1, daysLeft: 6, suggestedQty: 8 });
    assert.deepEqual(restockLine({ stock: 0, sold: 4, windowDays: 30, coverDays: 14 }), { perDay: 0.13, daysLeft: 0, suggestedQty: 2 });
    assert.deepEqual(restockLine({ stock: 9, sold: 0, windowDays: 30, coverDays: 14 }), { perDay: 0, daysLeft: null, suggestedQty: 0 });
    assert.equal(restockLine({ stock: -3, sold: 30, windowDays: 30, coverDays: 14 }).daysLeft, 0, "oversold stock counts as 0");
  });
});

describe("restock suggestions", () => {
  it("lists active items running out, most urgent first; ignores cancelled, returned, archived and old sales", async () => {
    const list = await getRestockSuggestions(tenantId);
    assert.deepEqual(list.map((r) => r.title), ["Item out", "Item fast"]);
    const fast = list.find((r) => r.title === "Item fast")!;
    assert.equal(fast.sold, 30, "the cancelled order and the 45-day-old order don't count");
    assert.equal(fast.daysLeft, 6);
    assert.equal(fast.suggestedQty, 8);
  });
});

describe("advisor facts", () => {
  it("summarises only this shop's real numbers", async () => {
    const f = await getAdvisorFacts(tenantId);
    assert.equal(f.shopName, "Insight Shop");
    assert.equal(f.orders, 5, "cancelled and 45-day-old orders excluded");
    assert.equal(f.topProducts[0]?.title, "Item fast");
    assert.equal(f.pendingPayments, 1);
    assert.ok(f.restock.some((r) => r.title === "Item fast"));
  });
});

describe("reply facts", () => {
  it("lists active products with price and stock, best sellers first", async () => {
    const { getReplyFacts } = await import("./queries/insights");
    const lines = await getReplyFacts(tenantId);
    assert.equal(lines[0], "Item fast: ₱100, 6 in stock");
    assert.ok(lines.includes("Item out: ₱100, out of stock"));
    assert.ok(!lines.some((l) => l.startsWith("Item archived")), "archived products are not offered");
  });
});
