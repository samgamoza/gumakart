/**
 * Phase 11 — after-sale and BIR-ready POS (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { editOrderItems, getAfterSaleView, recordReturn, updateOrderNotes, voidPosSale } from "./queries/after-sale";
import { createZReading, getXReading, posEJournalCsv } from "./queries/bir";
import { applyOrderAction } from "./queries/order-lifecycle";
import { confirmManualOrderPayment } from "./queries/manual-payments";
import { OrderError } from "./queries/order-status";
import { createOrderForTenant } from "./queries/orders";
import { closeShift, createPosSale, ensureRegister, getPosReceipt, getShiftSummary, openShift } from "./queries/pos";
import { saveProductVariants } from "./queries/variants";
import {
  customers,
  domainEvents,
  locations,
  orderItems,
  orderReturns,
  orderStatusHistory,
  orders,
  paymentTransactions,
  posInvoiceCounters,
  posZReadings,
  productVariants,
  products,
  registerSessions,
  registers,
  stockMovements,
  tenants,
  tenantWallets,
  walletLedgerEntries,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-after-${run}` };
const ids = { a: "", aVar: "", b: "", bS: "", bM: "" };
let registerId = "";
let shiftId = "";
const actor = { userId: null, name: "Tess" };
const key = () => randomUUID().replace(/-/g, "");

async function stock(variantId: string) {
  const [v] = await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId));
  return v!.q ?? 0;
}
async function order(id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  return o!;
}
const online = (items: Array<{ productId: string; variantId?: string; quantity: number }>, paymentMethod = "cod") =>
  createOrderForTenant({
    tenantSlug: shop.slug,
    items,
    customer: { name: "Buyer", phone: "09170001111" },
    deliveryType: "pickup",
    paymentMethod,
    deliveryFee: 0,
    minOrderAmount: 0,
  });
const sale = (items: Array<{ productId: string; variantId?: string; quantity: number }>, amount: number) =>
  createPosSale({
    tenantId: shop.id,
    shiftId,
    staffId: null,
    userId: null,
    cashierName: "Tess",
    idempotencyKey: key(),
    items,
    discountType: "none",
    tenders: [{ method: "cash", amount }],
  });

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "After Shop", status: "active" }).returning();
  shop.id = t!.id;
  const [a] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Soap", slug: `soap-${run}`, status: "active", basePrice: "100.00", trackInventory: true })
    .returning();
  const [av] = await db.insert(productVariants).values({ productId: a!.id, title: "Default", price: "100.00", stockQty: 100 }).returning();
  ids.a = a!.id;
  ids.aVar = av!.id;
  const [b] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Shirt", slug: `shirt-${run}`, status: "active", basePrice: "200.00", trackInventory: true })
    .returning();
  const [bv] = await db.insert(productVariants).values({ productId: b!.id, title: "Default", price: "200.00", stockQty: 5 }).returning();
  ids.b = b!.id;
  const view = await saveProductVariants(shop.id, b!.id, {
    options: [{ name: "Size", values: ["S", "M"] }],
    variants: [
      { id: bv!.id, options: { Size: "S" }, price: 200, stockQty: 5 },
      { options: { Size: "M" }, price: 220, stockQty: 5 },
    ],
  });
  ids.bS = view.variants.find((v) => v.title === "S")!.id;
  ids.bM = view.variants.find((v) => v.title === "M")!.id;
  registerId = (await ensureRegister(shop.id)).id;
  shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 1000 })).id;
});

after(async () => {
  const tid = [shop.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(orderReturns).where(inArray(orderReturns.tenantId, tid));
  await db.delete(walletLedgerEntries).where(inArray(walletLedgerEntries.tenantId, tid));
  await db.delete(tenantWallets).where(inArray(tenantWallets.tenantId, tid));
  await db.delete(posZReadings).where(inArray(posZReadings.tenantId, tid));
  await db.delete(posInvoiceCounters).where(inArray(posInvoiceCounters.tenantId, tid));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tid));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tid));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tid));
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

describe("notes and tags", () => {
  it("normalises tags (trim, dedupe case-insensitively, max 10)", async () => {
    const o = await online([{ productId: ids.a, quantity: 1 }]);
    const r = await updateOrderNotes(shop.id, o.id, { staffNote: "  Call before 5pm ", tags: [" VIP ", "vip", "Rush", ...Array.from({ length: 12 }, (_, i) => `t${i}`)] });
    assert.equal(r.staffNote, "Call before 5pm");
    assert.equal(r.tags[0], "VIP");
    assert.equal(r.tags.length, 10);
    assert.ok(!r.tags.includes("vip"));
  });
});

describe("editing an order before packing", () => {
  it("changes quantities, adds a size, moves stock and re-totals", async () => {
    const o = await online([{ productId: ids.a, quantity: 2 }]);
    assert.equal(await stock(ids.aVar), 97, "100 - 1 (notes test) - 2");
    const view = await getAfterSaleView(shop.id, o.id);
    assert.ok(view!.canEdit);
    const res = await editOrderItems(
      shop.id,
      o.id,
      [
        { orderItemId: view!.lines[0]!.orderItemId, qty: 3 },
        { productId: ids.b, variantId: ids.bM, qty: 1 },
      ],
      actor
    );
    assert.equal(res.newTotal, 300 + 220);
    assert.equal(res.refundDue, 0);
    assert.equal(await stock(ids.aVar), 96);
    assert.equal(await stock(ids.bM), 4);
    const after = await order(o.id);
    assert.equal(Number(after.total), 520);
    assert.ok(after.editedAt);

    // Remove the shirt again: stock comes back.
    const v2 = await getAfterSaleView(shop.id, o.id);
    const shirt = v2!.lines.find((l) => l.variantId === ids.bM)!;
    await editOrderItems(shop.id, o.id, [{ orderItemId: shirt.orderItemId, qty: 0 }], actor);
    assert.equal(await stock(ids.bM), 5);
    // A product with sizes needs a size.
    await assert.rejects(editOrderItems(shop.id, o.id, [{ productId: ids.b, qty: 1 }], actor), (e: unknown) => e instanceof OrderError && /Pick a size/.test(e.message));
    // Can't empty the order.
    const v3 = await getAfterSaleView(shop.id, o.id);
    await assert.rejects(editOrderItems(shop.id, o.id, [{ orderItemId: v3!.lines[0]!.orderItemId, qty: 0 }], actor), (e: unknown) => e instanceof OrderError && e.code === "EMPTY_CART");
  });

  it("paid orders can only go down — the difference is owed back", async () => {
    const o = await online([{ productId: ids.a, quantity: 3 }], "gcash");
    const ok = await confirmManualOrderPayment({ tenantId: shop.id, orderId: o.id });
    assert.ok(ok.ok, ok.error);
    const v = await getAfterSaleView(shop.id, o.id);
    const line = v!.lines[0]!.orderItemId;
    await assert.rejects(editOrderItems(shop.id, o.id, [{ orderItemId: line, qty: 4 }], actor), /already paid/);
    const res = await editOrderItems(shop.id, o.id, [{ orderItemId: line, qty: 1 }], actor);
    assert.equal(res.refundDue, 200);
    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.orderId, o.id));
    assert.equal(row!.kind, "edit");
    assert.equal(Number(row!.refundAmount), 200);
    assert.equal(row!.refundMethod, "shop");
  });

  it("packed orders and POS sales can't be edited", async () => {
    const o = await online([{ productId: ids.a, quantity: 1 }]);
    await applyOrderAction({ orderId: o.id, tenantId: shop.id, action: { type: "mark_ready" }, source: "seller" });
    const v = await getAfterSaleView(shop.id, o.id);
    assert.equal(v!.canEdit, false);
    await assert.rejects(editOrderItems(shop.id, o.id, [{ orderItemId: v!.lines[0]!.orderItemId, qty: 2 }], actor), /packed/);
  });
});

describe("returns, exchanges and voids at the POS", () => {
  let saleId = "";

  it("a return restocks and takes the refund out of the drawer", async () => {
    const r = await sale(
      [
        { productId: ids.a, quantity: 2 },
        { productId: ids.b, variantId: ids.bS, quantity: 1 },
      ],
      400
    );
    saleId = r.orderId;
    const stockA = await stock(ids.aVar);
    const v = await getAfterSaleView(shop.id, saleId);
    assert.ok(v!.canReturn, v!.returnBlockedReason ?? "");
    const soapLine = v!.lines.find((l) => l.variantId === ids.aVar)!;
    const res = await recordReturn(
      shop.id,
      saleId,
      { items: [{ orderItemId: soapLine.orderItemId, qty: 1, restock: true }], refundAmount: 100, refundMethod: "cash", registerSessionId: shiftId },
      actor
    );
    assert.equal(res.refunded, 100);
    assert.equal(res.fullyRefunded, false);
    assert.equal(await stock(ids.aVar), stockA + 1);
    const o = await order(saleId);
    assert.equal(Number(o.refundedAmount), 100);
    assert.equal(o.paymentState, "paid", "partial refunds keep the order paid");
    const summary = await getShiftSummary(shop.id, shiftId);
    assert.equal(summary!.refunds.cash, 100);
    assert.equal(summary!.expected.cash, 1000 + 400 - 100);

    await assert.rejects(
      recordReturn(shop.id, saleId, { items: [{ orderItemId: soapLine.orderItemId, qty: 2, restock: true }], refundAmount: 0, refundMethod: "none" }, actor),
      /1 can still come back/
    );
    await assert.rejects(recordReturn(shop.id, saleId, { items: [], refundAmount: 500, refundMethod: "cash" }, actor), /up to ₱300.00/);
  });

  it("an exchange swaps a size and records the difference collected", async () => {
    const v = await getAfterSaleView(shop.id, saleId);
    const shirt = v!.lines.find((l) => l.variantId === ids.bS)!;
    const [sBefore, mBefore] = [await stock(ids.bS), await stock(ids.bM)];
    const res = await recordReturn(
      shop.id,
      saleId,
      {
        items: [{ orderItemId: shirt.orderItemId, qty: 1, restock: true, replacementVariantId: ids.bM }],
        refundAmount: 0,
        collectedAmount: 20,
        refundMethod: "gcash",
        registerSessionId: shiftId,
      },
      actor
    );
    assert.match(res.summary, /Exchange/);
    assert.equal(await stock(ids.bS), sBefore + 1);
    assert.equal(await stock(ids.bM), mBefore - 1);
    const summary = await getShiftSummary(shop.id, shiftId);
    assert.equal(summary!.refunds.gcash, -20, "collected money adds to the drawer");
    await assert.rejects(
      recordReturn(shop.id, saleId, { items: [], refundAmount: 0, collectedAmount: 5, refundMethod: "cash" }, actor),
      /Pick the items/
    );
  });

  it("refunding the rest closes the order as refunded", async () => {
    const res = await recordReturn(shop.id, saleId, { items: [], refundAmount: 300, refundMethod: "cash", registerSessionId: shiftId }, actor);
    assert.equal(res.fullyRefunded, true);
    const o = await order(saleId);
    assert.equal(o.paymentState, "refunded");
    assert.equal(o.orderState, "cancelled");
    assert.equal((await getAfterSaleView(shop.id, saleId))!.canReturn, false);
  });

  it("a void reverses a sale in the same shift only", async () => {
    const r = await sale([{ productId: ids.a, quantity: 3 }], 300);
    const before = await stock(ids.aVar);
    const sum0 = await getShiftSummary(shop.id, shiftId);
    await assert.rejects(voidPosSale(shop.id, r.orderId, { openShiftId: shiftId, reason: " " }, actor), /Say why/);
    const v = await voidPosSale(shop.id, r.orderId, { openShiftId: shiftId, reason: "Wrong item rung" }, actor);
    assert.equal(v.total, 300);
    assert.equal(await stock(ids.aVar), before + 3);
    const sum1 = await getShiftSummary(shop.id, shiftId);
    assert.equal(sum1!.sales, sum0!.sales - 1);
    assert.equal(sum1!.expected.cash, sum0!.expected.cash - 300);
    await assert.rejects(voidPosSale(shop.id, r.orderId, { openShiftId: shiftId, reason: "again" }, actor), /already voided/);
    assert.equal((await getPosReceipt(shop.id, r.orderId))!.voided, true);
  });

  it("online orders not yet received can't be returned", async () => {
    const o = await online([{ productId: ids.a, quantity: 1 }], "gcash");
    await confirmManualOrderPayment({ tenantId: shop.id, orderId: o.id });
    const v = await getAfterSaleView(shop.id, o.id);
    assert.equal(v!.canReturn, false);
    assert.match(v!.returnBlockedReason ?? "", /already received/);
  });
});

describe("BIR-ready POS", () => {
  it("numbers invoices only when the shop turns it on with its PTU details", async () => {
    const plain = await sale([{ productId: ids.a, quantity: 1 }], 100);
    assert.equal(plain.invoiceNumber, null);
    // Turned on but incomplete → still off.
    await db.update(tenants).set({ settingsJson: { pos: { bir: { enabled: true, tin: "123-456-789-000" } } } as never }).where(eq(tenants.id, shop.id));
    assert.equal((await sale([{ productId: ids.a, quantity: 1 }], 100)).invoiceNumber, null);
    await db
      .update(tenants)
      .set({
        settingsJson: {
          pos: {
            vatRegistered: false,
            bir: { enabled: true, registeredName: "After Shop", tin: "123-456-789-000", address: "Cebu City", min: "MIN123", serialNo: "SN1", ptuNo: "PTU-1", invoicePrefix: "si" },
          },
        } as never,
      })
      .where(eq(tenants.id, shop.id));
    const one = await sale([{ productId: ids.a, quantity: 1 }], 100);
    const two = await sale([{ productId: ids.a, quantity: 1 }], 100);
    assert.equal(one.invoiceNumber, "SI0000000001");
    assert.equal(two.invoiceNumber, "SI0000000002");
    const receipt = await getPosReceipt(shop.id, two.orderId);
    assert.equal(receipt!.bir?.ptuNo, "PTU-1");
  });

  it("X reading summarises the shift; Z needs it closed and moves the grand total", async () => {
    const x = await getXReading(shop.id, shiftId);
    assert.equal(x!.totals.voidCount, 1);
    assert.equal(x!.totals.voids, 300);
    assert.equal(x!.totals.returnCount, 3);
    assert.equal(x!.totals.firstInvoice, "SI0000000001");
    assert.equal(x!.totals.lastInvoice, "SI0000000002");
    await assert.rejects(createZReading(shop.id, registerId, "Tess"), /Close the open shift/);

    const summary = await getShiftSummary(shop.id, shiftId);
    await closeShift({ tenantId: shop.id, shiftId, counted: summary!.expected });
    const z1 = await createZReading(shop.id, registerId, "Tess");
    assert.equal(z1.zNumber, 1);
    assert.equal(z1.grandTotalBefore, 0);
    assert.equal(z1.grandTotalAfter, x!.totals.netSales);
    const z2 = await createZReading(shop.id, registerId, "Tess");
    assert.equal(z2.zNumber, 2);
    assert.equal(z2.totals.transactions, 0, "nothing since the last Z");
    assert.equal(z2.grandTotalBefore, z1.grandTotalAfter);
  });

  it("the e-journal lists every receipt", async () => {
    const csv = await posEJournalCsv(shop.id, new Date(Date.now() - 86_400_000), new Date());
    const rows = csv.trim().split("\r\n");
    assert.match(rows[0]!, /^date_time,invoice_no,order_no/);
    assert.ok(rows.some((r) => r.includes("SI0000000002")));
    assert.ok(rows.some((r) => r.includes(",yes,")), "the void is marked");
  });
});
