/**
 * Phase 17 — deals at the POS, gift cards & store credit, branch stock (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { getAfterSaleView, recordReturn, voidPosSale } from "./queries/after-sale";
import { createBranch, getBranchStock, listBranches, setBranchCount, transferStock, updateBranch } from "./queries/branches";
import {
  adjustGiftCard,
  checkGiftCard,
  GiftCardError,
  getGiftCardHistory,
  issueGiftCard,
  restoreGiftCardsForOrderInTx,
  setGiftCardStatus,
} from "./queries/gift-cards";
import { applyOrderAction } from "./queries/order-lifecycle";
import { OrderError } from "./queries/order-status";
import { createOrderForTenant } from "./queries/orders";
import { closeShift, createPosSale, ensureRegister, getShiftSummary, openShift, PosError } from "./queries/pos";
import {
  customers,
  domainEvents,
  giftCardTxns,
  giftCards,
  locationStock,
  locations,
  orderItems,
  orderReturns,
  orderStatusHistory,
  orders,
  paymentTransactions,
  posInvoiceCounters,
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
const shop = { id: "", slug: `test-polish-${run}` };
const ids = { soap: "", soapVar: "", shirt: "", shirtVar: "" };
let registerId = "";
let shiftId = "";
const actor = { userId: null, name: "Tess" };
const key = () => randomUUID().replace(/-/g, "");

async function stock(variantId: string) {
  const [v] = await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId));
  return v!.q ?? 0;
}
async function balance(code: string) {
  const [c] = await db.select({ b: giftCards.balance }).from(giftCards).where(and(eq(giftCards.tenantId, shop.id), eq(giftCards.code, code)));
  return Number(c!.b);
}
async function order(id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  return o!;
}
async function branchQty(locationId: string, variantId: string) {
  const [r] = await db
    .select({ q: locationStock.qty })
    .from(locationStock)
    .where(and(eq(locationStock.locationId, locationId), eq(locationStock.variantId, variantId)));
  return r?.q ?? 0;
}
/** The rule the trigger keeps: branch numbers add up to the shop-wide stock. */
async function assertInvariant(variantId: string) {
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${locationStock.qty}), 0)::int` })
    .from(locationStock)
    .where(eq(locationStock.variantId, variantId));
  assert.equal(r!.s, await stock(variantId), "branch stock adds up to the total");
}
const online = (items: Array<{ productId: string; variantId?: string; quantity: number }>, giftCardCode?: string) =>
  createOrderForTenant({
    tenantSlug: shop.slug,
    items,
    customer: { name: "Buyer", phone: "09170002222" },
    deliveryType: "pickup",
    paymentMethod: "cod",
    deliveryFee: 0,
    minOrderAmount: 0,
    giftCardCode,
  });
const sale = (
  items: Array<{ productId: string; variantId?: string; quantity: number }>,
  tenders: Array<{ method: "cash" | "gift_card"; amount: number; reference?: string }>,
  opts: { shift?: string; discountType?: "none" | "senior" } = {}
) =>
  createPosSale({
    tenantId: shop.id,
    shiftId: opts.shift ?? shiftId,
    staffId: null,
    userId: null,
    cashierName: "Tess",
    idempotencyKey: key(),
    items,
    discountType: opts.discountType ?? "none",
    ...(opts.discountType === "senior" ? { discountHolder: { name: "Lola", idNumber: "SC-12345" } } : {}),
    tenders,
  } as Parameters<typeof createPosSale>[0]);

before(async () => {
  const [t] = await db
    .insert(tenants)
    .values({
      slug: shop.slug,
      name: "Polish Shop",
      status: "active",
      checkoutPublishedJson: {
        volumeDiscounts: [{ id: "v1", label: "3+ soap 10% off", productIds: [], minQty: 3, type: "percent", value: 10 }],
      } as never,
    })
    .returning();
  shop.id = t!.id;
  const [a] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Soap", slug: `soap-${run}`, status: "active", basePrice: "100.00", trackInventory: true })
    .returning();
  const [av] = await db.insert(productVariants).values({ productId: a!.id, title: "Default", price: "100.00", stockQty: 100 }).returning();
  ids.soap = a!.id;
  ids.soapVar = av!.id;
  const [b] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Shirt", slug: `shirt-${run}`, status: "active", basePrice: "200.00", trackInventory: true })
    .returning();
  const [bv] = await db.insert(productVariants).values({ productId: b!.id, title: "Default", price: "200.00", stockQty: 20 }).returning();
  ids.shirt = b!.id;
  ids.shirtVar = bv!.id;
  registerId = (await ensureRegister(shop.id)).id;
  shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 1000 })).id;
});

after(async () => {
  const tid = [shop.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(giftCardTxns).where(inArray(giftCardTxns.tenantId, tid));
  await db.delete(giftCards).where(inArray(giftCards.tenantId, tid));
  await db.delete(locationStock).where(inArray(locationStock.tenantId, tid));
  await db.delete(orderReturns).where(inArray(orderReturns.tenantId, tid));
  await db.delete(walletLedgerEntries).where(inArray(walletLedgerEntries.tenantId, tid));
  await db.delete(tenantWallets).where(inArray(tenantWallets.tenantId, tid));
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

describe("gift cards", () => {
  it("issue, check, adjust, disable", async () => {
    const card = await issueGiftCard({ tenantId: shop.id, amount: 500, createdByName: "Tess", recipientName: "Ana", customerPhone: "09170003333" });
    assert.match(card.code, /^GC-/);
    assert.equal(card.balance, 500);
    const chk = await checkGiftCard(shop.id, card.code.toLowerCase());
    assert.equal(chk.balance, 500);
    await adjustGiftCard(shop.id, card.id, -100, "Typo", "Tess");
    assert.equal(await balance(card.code), 400);
    await assert.rejects(adjustGiftCard(shop.id, card.id, -1000, "Too much", "Tess"), GiftCardError);
    await setGiftCardStatus(shop.id, card.id, "disabled");
    await assert.rejects(checkGiftCard(shop.id, card.code), (e: unknown) => e instanceof GiftCardError && e.code === "INACTIVE");
    await setGiftCardStatus(shop.id, card.id, "active");
    const hist = await getGiftCardHistory(shop.id, card.id);
    assert.deepEqual(hist.map((h) => h.kind).sort(), ["adjust", "issue"]);
  });
  it("rejects bad amounts, past expiry and other shops' codes", async () => {
    await assert.rejects(issueGiftCard({ tenantId: shop.id, amount: 0, createdByName: "Tess" }), GiftCardError);
    await assert.rejects(issueGiftCard({ tenantId: shop.id, amount: 100, createdByName: "Tess", expiresAt: new Date(Date.now() - 1000) }), GiftCardError);
    await assert.rejects(checkGiftCard(randomUUID(), "GC-AAAA-BBBB"), GiftCardError);
  });
});

describe("gift card at online checkout", () => {
  it("partial: card covers part, the rest is due; cancel puts it back (once)", async () => {
    const card = await issueGiftCard({ tenantId: shop.id, amount: 150, createdByName: "Tess" });
    const o = await online([{ productId: ids.soap, quantity: 2 }], card.code);
    assert.equal(Number(o.giftCardAmount), 150);
    assert.equal(Number(o.amountDue), 50);
    assert.equal(o.amountDueCentavos, 5000);
    assert.equal(o.paidInFull, false);
    assert.equal(await balance(card.code), 0);
    const row = await order(o.id);
    assert.equal(Number(row.giftCardAmount), 150);
    assert.notEqual(row.paymentState, "paid");

    await applyOrderAction({ orderId: o.id, tenantId: shop.id, action: { type: "cancel" }, source: "seller" });
    assert.equal(await balance(card.code), 150, "cancel restores the card");
    const again = await db.transaction((tx) => restoreGiftCardsForOrderInTx(tx, { tenantId: shop.id, orderId: o.id, actorName: "Tess" }));
    assert.equal(again, 0, "restoring twice does nothing");
    assert.equal(await balance(card.code), 150);
  });
  it("full: card covers everything and the order is paid", async () => {
    const card = await issueGiftCard({ tenantId: shop.id, amount: 500, createdByName: "Tess" });
    const o = await online([{ productId: ids.soap, quantity: 1 }], card.code);
    assert.equal(o.paidInFull, true);
    assert.equal(Number(o.amountDue), 0);
    assert.equal(await balance(card.code), 400);
    const row = await order(o.id);
    assert.equal(row.paymentState, "paid");
  });
  it("a bad code stops the order and takes nothing", async () => {
    const before = await stock(ids.soapVar);
    await assert.rejects(online([{ productId: ids.soap, quantity: 1 }], "GC-ZZZZ-ZZZZ"), (e: unknown) => e instanceof OrderError || e instanceof GiftCardError);
    assert.equal(await stock(ids.soapVar), before);
  });
});

describe("POS: deals, gift card tender, store credit", () => {
  it("quantity deal shows on the receipt and comes off the total", async () => {
    const r = await sale([{ productId: ids.soap, quantity: 3 }], [{ method: "cash", amount: 270 }]);
    assert.equal(r.totals.subtotal, 300);
    assert.equal(r.totals.promoAmount, 30);
    assert.equal(r.totals.total, 270);
    const row = await order(r.orderId);
    assert.equal(Number(row.discount), 30);
  });
  it("senior gets the better of the deal or the 20% — not both", async () => {
    const r = await sale([{ productId: ids.soap, quantity: 3 }], [{ method: "cash", amount: 300 }], { discountType: "senior" });
    assert.equal(r.totals.promoAmount, 0, "20% beats 10%");
    assert.ok(r.totals.discountAmount > 0);
    assert.ok(r.totals.total < 270);
  });
  it("gift card tender: exact amount comes off the card; short cards are refused", async () => {
    const card = await issueGiftCard({ tenantId: shop.id, amount: 300, createdByName: "Tess" });
    const r = await sale([{ productId: ids.shirt, quantity: 1 }], [{ method: "gift_card", amount: 200, reference: card.code }]);
    assert.equal(r.totals.total, 200);
    assert.equal(await balance(card.code), 100);
    await assert.rejects(
      sale([{ productId: ids.shirt, quantity: 1 }], [{ method: "gift_card", amount: 200, reference: card.code }]),
      (e: unknown) => e instanceof GiftCardError || e instanceof PosError
    );
    assert.equal(await balance(card.code), 100, "a refused sale takes nothing");
    // split: rest of the card + cash
    const s = await sale(
      [{ productId: ids.shirt, quantity: 1 }],
      [
        { method: "gift_card", amount: 100, reference: card.code },
        { method: "cash", amount: 100 },
      ]
    );
    assert.equal(s.totals.total, 200);
    assert.equal(await balance(card.code), 0);
  });
  it("voiding a sale paid by card puts the money back on the card", async () => {
    const card = await issueGiftCard({ tenantId: shop.id, amount: 100, createdByName: "Tess" });
    const r = await sale([{ productId: ids.soap, quantity: 1 }], [{ method: "gift_card", amount: 100, reference: card.code }]);
    assert.equal(await balance(card.code), 0);
    await voidPosSale(shop.id, r.orderId, { openShiftId: shiftId, reason: "Wrong item" }, actor);
    assert.equal(await balance(card.code), 100);
  });
  it("return as store credit issues a card for the refund", async () => {
    const r = await sale([{ productId: ids.soap, quantity: 1 }], [{ method: "cash", amount: 100 }]);
    const v = await getAfterSaleView(shop.id, r.orderId);
    const line = v!.lines[0]!;
    const res = await recordReturn(
      shop.id,
      r.orderId,
      { items: [{ orderItemId: line.orderItemId, qty: 1, restock: true }], refundAmount: 100, refundMethod: "store_credit", registerSessionId: shiftId },
      actor
    );
    assert.ok(res.storeCredit);
    assert.equal(res.storeCredit!.amount, 100);
    const [c] = await db.select().from(giftCards).where(eq(giftCards.code, res.storeCredit!.code));
    assert.equal(c!.kind, "store_credit");
    const summary = await getShiftSummary(shop.id, shiftId);
    assert.equal(summary!.refunds.cash, 0, "store credit isn't cash out of the drawer");
  });
  it("closing the shift: gift card counted = expected, no variance", async () => {
    const summary = await getShiftSummary(shop.id, shiftId);
    const closed = await closeShift({ tenantId: shop.id, shiftId, counted: { ...summary!.expected, gift_card: 0 } });
    assert.equal(closed.variance!.gift_card, 0);
    assert.equal(closed.counted!.gift_card, closed.expected!.gift_card);
    assert.ok(closed.expected!.gift_card >= 300);
    shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 1000 })).id;
  });
});

describe("branch stock", () => {
  let main = "";
  let stall = "";
  it("off until a second branch exists", async () => {
    const l = await listBranches(shop.id);
    assert.equal(l.enabled, false);
    await assert.rejects(transferStock(shop.id, { fromId: randomUUID(), toId: randomUUID(), items: [{ variantId: ids.soapVar, qty: 1 }] }, actor));
  });
  it("adding a branch seeds the main branch with today's stock", async () => {
    const b = await createBranch(shop.id, { name: "SM Lipa stall", city: "Lipa" });
    stall = b.id;
    const l = await listBranches(shop.id);
    assert.equal(l.enabled, true);
    assert.equal(l.branches.length, 2);
    main = l.branches.find((x) => x.isDefault)!.id;
    assert.equal(await branchQty(main, ids.soapVar), await stock(ids.soapVar));
    assert.equal(await branchQty(stall, ids.soapVar), 0);
    await assertInvariant(ids.soapVar);
    await assertInvariant(ids.shirtVar);
  });
  it("transfer moves stock without changing the total", async () => {
    const total = await stock(ids.soapVar);
    await transferStock(shop.id, { fromId: main, toId: stall, items: [{ variantId: ids.soapVar, qty: 10 }] }, actor);
    assert.equal(await stock(ids.soapVar), total);
    assert.equal(await branchQty(stall, ids.soapVar), 10);
    await assertInvariant(ids.soapVar);
    await assert.rejects(transferStock(shop.id, { fromId: stall, toId: main, items: [{ variantId: ids.soapVar, qty: 11 }] }, actor), /only has 10/);
    const moves = await db
      .select({ reason: stockMovements.reason })
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, shop.id), inArray(stockMovements.reason, ["transfer_out", "transfer_in"])));
    assert.equal(moves.length, 2);
  });
  it("a count at one branch moves the total by the difference", async () => {
    const total = await stock(ids.soapVar);
    const mainQty = await branchQty(main, ids.soapVar);
    await setBranchCount(shop.id, main, [{ variantId: ids.soapVar, qty: 2 }], actor);
    assert.equal(await branchQty(main, ids.soapVar), 2);
    assert.equal(await stock(ids.soapVar), total - (mainQty - 2));
    assert.equal(await stock(ids.soapVar), 12);
    await assertInvariant(ids.soapVar);
  });
  it("online orders take from the main branch, then spill to others", async () => {
    await online([{ productId: ids.soap, quantity: 4 }]);
    assert.equal(await branchQty(main, ids.soapVar), 0);
    assert.equal(await branchQty(stall, ids.soapVar), 8);
    await assertInvariant(ids.soapVar);
  });
  it("a POS at the stall sells from the stall", async () => {
    const reg = await ensureRegister(shop.id, stall);
    assert.notEqual(reg.id, registerId);
    const s = (await openShift({ tenantId: shop.id, registerId: reg.id, openingCash: 0 })).id;
    const shirtMain = await branchQty(main, ids.shirtVar);
    await transferStock(shop.id, { fromId: main, toId: stall, items: [{ variantId: ids.shirtVar, qty: 3 }] }, actor);
    await sale([{ productId: ids.shirt, quantity: 1 }], [{ method: "cash", amount: 200 }], { shift: s });
    assert.equal(await branchQty(stall, ids.shirtVar), 2);
    assert.equal(await branchQty(main, ids.shirtVar), shirtMain - 3);
    await assertInvariant(ids.shirtVar);
    const view = await getBranchStock(shop.id);
    const row = view.rows.find((r) => r.variantId === ids.shirtVar)!;
    assert.ok(row);
  });
  it("can't close a branch that still has stock, or the main branch", async () => {
    await assert.rejects(updateBranch(shop.id, stall, { isActive: false }));
    await assert.rejects(updateBranch(shop.id, main, { isActive: false }));
  });
});
