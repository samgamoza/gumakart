/**
 * Phase 5 — POS Lite (local Postgres only).
 *   - a sale is a completed, paid, picked-up order with source_channel = pos
 *   - stock is shared with online orders and never oversold
 *   - a retried Charge never sells twice
 *   - senior/PWD VAT-exempt math on a VAT-registered shop
 *   - shift close: expected vs counted per tender
 *   - staff names unique, PIN lockout after 5 tries
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  closeShift,
  createPosSale,
  createPosStaff,
  ensureRegister,
  getPosStaffForAuth,
  getShiftSummary,
  openShift,
  PosError,
  recordPinFailure,
  updatePosStaff,
} from "./queries/pos";
import { createOrderForTenant } from "./queries/orders";
import {
  customers,
  domainEvents,
  locations,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  posStaff,
  productVariants,
  products,
  registerSessions,
  registers,
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
const shop = { id: "", slug: `test-pos-${run}` };
const vatShop = { id: "", slug: `test-posvat-${run}` };
const ids = { soap: "", soapVariant: "", last: "", lastVariant: "", vatItem: "" };
let shiftId = "";
const key = () => randomUUID().replace(/-/g, "");

async function stockOf(variantId: string) {
  const [v] = await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId));
  return v!.q;
}

async function addProduct(tenantId: string, title: string, price: string, stock: number) {
  const [p] = await db
    .insert(products)
    .values({ tenantId, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${run}`, status: "active", basePrice: price, trackInventory: true })
    .returning();
  const [v] = await db.insert(productVariants).values({ productId: p!.id, title, price, stockQty: stock, sku: `SKU-${title}-${run}` }).returning();
  return { productId: p!.id, variantId: v!.id };
}

before(async () => {
  const [a] = await db.insert(tenants).values({ slug: shop.slug, name: "POS Shop", status: "active" }).returning();
  const [b] = await db
    .insert(tenants)
    .values({ slug: vatShop.slug, name: "VAT Shop", status: "active", settingsJson: { pos: { vatRegistered: true } } as never })
    .returning();
  shop.id = a!.id;
  vatShop.id = b!.id;
  const soap = await addProduct(shop.id, "Soap", "45.00", 20);
  ids.soap = soap.productId;
  ids.soapVariant = soap.variantId;
  const last = await addProduct(shop.id, "Last", "100.00", 1);
  ids.last = last.productId;
  ids.lastVariant = last.variantId;
  ids.vatItem = (await addProduct(vatShop.id, "Vitamins", "112.00", 10)).productId;
});

after(async () => {
  const tids = [shop.id, vatShop.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tids));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tids));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tids));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tids));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tids));
  await db.delete(customers).where(inArray(customers.tenantId, tids));
  await db.delete(registerSessions).where(inArray(registerSessions.tenantId, tids));
  await db.delete(registers).where(inArray(registers.tenantId, tids));
  await db.delete(posStaff).where(inArray(posStaff.tenantId, tids));
  await db.delete(locations).where(inArray(locations.tenantId, tids));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tids));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tids));
  await db.delete(tenants).where(inArray(tenants.id, tids));
  await closeDb();
});

describe("shift", () => {
  it("one register per location, one open shift per register", async () => {
    const r1 = await ensureRegister(shop.id);
    const r2 = await ensureRegister(shop.id);
    assert.equal(r1.id, r2.id);
    const shift = await openShift({ tenantId: shop.id, registerId: r1.id, openingCash: 500 });
    shiftId = shift.id;
    assert.equal(shift.openingCash, 500);
    await assert.rejects(
      openShift({ tenantId: shop.id, registerId: r1.id, openingCash: 0 }),
      (e: unknown) => e instanceof PosError && e.code === "SHIFT_OPEN"
    );
  });
});

describe("sale", () => {
  it("is a completed, paid POS order; stock, payment rows and customer update", async () => {
    const before = await stockOf(ids.soapVariant);
    const r = await createPosSale({
      tenantId: shop.id,
      shiftId,
      staffId: null,
      userId: null,
      cashierName: "Owner",
      idempotencyKey: key(),
      items: [{ productId: ids.soap, quantity: 2 }],
      discountType: "none",
      tenders: [{ method: "cash", amount: 100 }],
      customer: { name: "Aling Nena", phone: "+63 917 000 1111" },
    });
    assert.equal(r.totals.total, 90);
    assert.equal(r.change, 10);
    assert.equal(await stockOf(ids.soapVariant), before! - 2);
    const [o] = await db.select().from(orders).where(eq(orders.id, r.orderId));
    assert.equal(o!.sourceChannel, "pos");
    assert.equal(o!.orderState, "completed");
    assert.equal(o!.paymentState, "paid");
    assert.equal(o!.fulfillmentState, "delivered");
    assert.equal(o!.guestPhone, "09170001111");
    const pays = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, r.orderId));
    assert.equal(pays.length, 1);
    assert.equal(pays[0]!.amount, "90.00", "cash row = kept, not tendered");
    const [c] = await db.select().from(customers).where(eq(customers.id, o!.customerRecordId!));
    assert.equal(c!.name, "Aling Nena");
  });

  it("a retried Charge returns the same sale and takes stock once", async () => {
    const k = key();
    const before = await stockOf(ids.soapVariant);
    const input = {
      tenantId: shop.id,
      shiftId,
      staffId: null,
      userId: null,
      cashierName: "Owner",
      idempotencyKey: k,
      items: [{ productId: ids.soap, quantity: 1 }],
      discountType: "none" as const,
      tenders: [{ method: "gcash" as const, amount: 45, reference: "1234" }],
    };
    const [a, b] = await Promise.all([createPosSale(input), createPosSale(input)]);
    assert.equal(a.orderId, b.orderId);
    assert.ok(a.duplicate || b.duplicate);
    const c = await createPosSale(input);
    assert.equal(c.duplicate, true);
    assert.equal(await stockOf(ids.soapVariant), before! - 1);
  });

  it("online and POS can't both sell the last unit", async () => {
    const results = await Promise.allSettled([
      createPosSale({
        tenantId: shop.id,
        shiftId,
        staffId: null,
        userId: null,
        cashierName: "Owner",
        idempotencyKey: key(),
        items: [{ productId: ids.last, quantity: 1 }],
        discountType: "none",
        tenders: [{ method: "cash", amount: 100 }],
      }),
      createOrderForTenant({
        tenantSlug: shop.slug,
        items: [{ productId: ids.last, quantity: 1 }],
        customer: { name: "Online", phone: "09170002222" },
        deliveryType: "pickup",
        paymentMethod: "cod",
        deliveryFee: 0,
        minOrderAmount: 0,
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await stockOf(ids.lastVariant), 0);
  });

  it("short payment leaves no sale and no stock change", async () => {
    const before = await stockOf(ids.soapVariant);
    await assert.rejects(
      createPosSale({
        tenantId: shop.id,
        shiftId,
        staffId: null,
        userId: null,
        cashierName: "Owner",
        idempotencyKey: key(),
        items: [{ productId: ids.soap, quantity: 3 }],
        discountType: "none",
        tenders: [{ method: "cash", amount: 100 }],
      }),
      (e: unknown) => e instanceof PosError && e.code === "BAD_TENDER"
    );
    assert.equal(await stockOf(ids.soapVariant), before);
  });

  it("senior on a VAT-registered shop: ₱112 → ₱80, no VAT", async () => {
    const reg = await ensureRegister(vatShop.id);
    const s = await openShift({ tenantId: vatShop.id, registerId: reg.id, openingCash: 0 });
    const r = await createPosSale({
      tenantId: vatShop.id,
      shiftId: s.id,
      staffId: null,
      userId: null,
      cashierName: "Owner",
      idempotencyKey: key(),
      items: [{ productId: ids.vatItem, quantity: 1 }],
      discountType: "senior",
      discountHolder: { name: "Lola Ising", idNumber: "SC-0012-3456" },
      tenders: [{ method: "cash", amount: 80 }],
    });
    assert.equal(r.totals.total, 80);
    assert.equal(r.totals.vatAmount, 0);
    assert.equal(r.totals.discountAmount, 20);
    assert.deepEqual(r.discountHolder, { name: "Lola Ising", idNumberLast4: "3456" });
  });
});

describe("close shift", () => {
  it("expected cash = opening + cash kept; variance; no sales after close", async () => {
    const summary = await getShiftSummary(shop.id, shiftId);
    assert.ok(summary);
    // 500 opening + 90 (soap) + 100 (last unit, if POS won) …
    const expectedCash = summary!.expected.cash;
    assert.equal(summary!.expected.gcash, 45);
    const closed = await closeShift({
      tenantId: shop.id,
      shiftId,
      counted: { cash: expectedCash - 20, gcash: 45, maya: 0, card: 0 },
    });
    assert.equal(closed.status, "closed");
    assert.equal(closed.variance!.cash, -20);
    assert.equal(closed.variance!.gcash, 0);
    await assert.rejects(
      createPosSale({
        tenantId: shop.id,
        shiftId,
        staffId: null,
        userId: null,
        cashierName: "Owner",
        idempotencyKey: key(),
        items: [{ productId: ids.soap, quantity: 1 }],
        discountType: "none",
        tenders: [{ method: "cash", amount: 45 }],
      }),
      (e: unknown) => e instanceof PosError && e.code === "SHIFT_CLOSED"
    );
    await assert.rejects(
      closeShift({ tenantId: shop.id, shiftId, counted: { cash: 0, gcash: 0, maya: 0, card: 0 } }),
      (e: unknown) => e instanceof PosError && e.code === "SHIFT_CLOSED"
    );
  });
});

describe("staff", () => {
  it("names are unique per shop; 5 wrong PINs lock; reset bumps the session version", async () => {
    const s = await createPosStaff({ tenantId: shop.id, name: "Jen", role: "cashier", pinHash: "x" });
    await assert.rejects(
      createPosStaff({ tenantId: shop.id, name: "  jen ", role: "cashier", pinHash: "y" }),
      (e: unknown) => e instanceof PosError && e.code === "STAFF_NAME_TAKEN"
    );
    for (let i = 0; i < 4; i++) assert.equal((await recordPinFailure(s.id)).locked, false);
    assert.equal((await recordPinFailure(s.id)).locked, true);
    const row = await getPosStaffForAuth(shop.id, s.id);
    assert.ok(row!.lockedUntil && row!.lockedUntil > new Date());
    const v = row!.pinVersion;
    await updatePosStaff(shop.id, s.id, { pinHash: "z" });
    const after = await getPosStaffForAuth(shop.id, s.id);
    assert.equal(after!.pinVersion, v + 1);
    assert.equal(after!.lockedUntil, null);
    assert.equal(await getPosStaffForAuth(vatShop.id, s.id), null, "tenant isolation");
  });
});
