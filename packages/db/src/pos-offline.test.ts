/**
 * Phase 12b — POS offline mode: late sync of sales rung without internet (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { createZReading, posEJournalCsv } from "./queries/bir";
import { clampRungAt, closeShift, createPosSale, ensureRegister, getShiftSummary, openShift, PosError, type PosSaleInput } from "./queries/pos";
import {
  countOpenSyncIssues,
  getOrReserveInvoiceBlock,
  listInvoiceBlocks,
  listSyncIssues,
  PosOfflineError,
  recordRejectedOfflineSale,
  releaseInvoiceBlock,
  resolveSyncIssue,
} from "./queries/pos-offline";
import {
  customers,
  domainEvents,
  locations,
  orderItems,
  orderStatusHistory,
  orders,
  paymentTransactions,
  posInvoiceBlocks,
  posInvoiceCounters,
  posSyncIssues,
  posZReadings,
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
const shop = { id: "", slug: `test-offline-${run}` };
const ids = { a: "", aVar: "", b: "", bVar: "" };
let registerId = "";
let shiftId = "";
const DEVICE = `dev${run}abcd`;
const key = () => randomUUID().replace(/-/g, "");

async function stock(variantId: string) {
  const [v] = await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId));
  return v!.q ?? 0;
}

function offlineSale(over: Partial<PosSaleInput> & { rungAt?: Date; invoiceNumber?: string | null }) {
  const { rungAt, invoiceNumber, ...rest } = over;
  return createPosSale({
    tenantId: shop.id,
    shiftId,
    staffId: null,
    userId: null,
    cashierName: "Tess",
    idempotencyKey: key(),
    items: [{ productId: ids.a, quantity: 1, unitPrice: 100 }],
    discountType: "none",
    tenders: [{ method: "cash", amount: 100 }],
    offline: { rungAt: rungAt ?? new Date(), deviceId: DEVICE, invoiceNumber: invoiceNumber ?? null },
    ...rest,
  });
}

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "Offline Shop", status: "active" }).returning();
  shop.id = t!.id;
  const [a] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Soap", slug: `soap-${run}`, status: "active", basePrice: "100.00", trackInventory: true })
    .returning();
  const [av] = await db.insert(productVariants).values({ productId: a!.id, title: "Default", price: "100.00", stockQty: 50 }).returning();
  ids.a = a!.id;
  ids.aVar = av!.id;
  const [b] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Candle", slug: `candle-${run}`, status: "active", basePrice: "80.00", trackInventory: true })
    .returning();
  const [bv] = await db.insert(productVariants).values({ productId: b!.id, title: "Default", price: "80.00", stockQty: 2 }).returning();
  ids.b = b!.id;
  ids.bVar = bv!.id;
  registerId = (await ensureRegister(shop.id)).id;
  shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 500 })).id;
});

after(async () => {
  const tid = [shop.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(posSyncIssues).where(inArray(posSyncIssues.tenantId, tid));
  await db.delete(posInvoiceBlocks).where(inArray(posInvoiceBlocks.tenantId, tid));
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

describe("time", () => {
  it("keeps the device time inside the shift", () => {
    const open = new Date("2026-10-01T01:00:00Z");
    const close = new Date("2026-10-01T09:00:00Z");
    const now = new Date("2026-10-02T00:00:00Z");
    assert.equal(clampRungAt(new Date("2026-10-01T05:00:00Z"), open, close, now).toISOString(), "2026-10-01T05:00:00.000Z");
    assert.equal(clampRungAt(new Date("2026-09-01T05:00:00Z"), open, close, now).getTime(), open.getTime());
    assert.equal(clampRungAt(new Date("2027-01-01T00:00:00Z"), open, close, now).getTime(), close.getTime());
    assert.equal(clampRungAt(new Date("2027-01-01T00:00:00Z"), open, null, now).getTime(), now.getTime());
    assert.equal(clampRungAt(new Date("garbage"), open, null, now).getTime(), now.getTime());
  });
});

describe("syncing offline sales", () => {
  it("saves with the device's time, is idempotent, and marks the receipt offline", async () => {
    const k = key();
    const rungAt = new Date();
    const first = await offlineSale({ idempotencyKey: k, rungAt });
    assert.equal(first.offline, true);
    assert.equal(first.syncIssues, undefined);
    assert.ok(Math.abs(new Date(first.createdAt).getTime() - rungAt.getTime()) < 1000);
    const again = await offlineSale({ idempotencyKey: k, rungAt });
    assert.equal(again.duplicate, true);
    assert.equal(again.orderId, first.orderId);
    const [o] = await db.select().from(orders).where(eq(orders.id, first.orderId));
    assert.equal(o!.posDeviceId, DEVICE);
    assert.ok(o!.posOfflineAt);
  });

  it("stock ran short: records the sale, takes what's there, files an issue", async () => {
    const before = await countOpenSyncIssues(shop.id);
    const r = await offlineSale({ items: [{ productId: ids.b, quantity: 3, unitPrice: 80 }], tenders: [{ method: "cash", amount: 240 }] });
    assert.equal(r.syncIssues, 1);
    assert.equal(await stock(ids.bVar), 0, "never below zero");
    const issues = await listSyncIssues(shop.id, { open: true });
    assert.equal(issues.length, before + 1);
    assert.equal(issues[0]!.kind, "stock_short");
    assert.equal((issues[0]!.detail as { short: number }).short, 1);
    // Online sales still refuse when out of stock.
    await assert.rejects(
      createPosSale({
        tenantId: shop.id,
        shiftId,
        staffId: null,
        userId: null,
        cashierName: "Tess",
        idempotencyKey: key(),
        items: [{ productId: ids.b, quantity: 1 }],
        discountType: "none",
        tenders: [{ method: "cash", amount: 80 }],
      }),
      (e: unknown) => (e as { code?: string }).code === "OUT_OF_STOCK"
    );
  });

  it("price changed meanwhile: keeps what the buyer paid and flags it", async () => {
    await db.update(products).set({ basePrice: "120.00" }).where(eq(products.id, ids.a));
    await db.update(productVariants).set({ price: "120.00" }).where(eq(productVariants.id, ids.aVar));
    const r = await offlineSale({});
    assert.equal(r.totals.total, 100);
    assert.equal(r.items[0]!.unitPrice, 100);
    const [issue] = await listSyncIssues(shop.id, { open: true });
    assert.equal(issue!.kind, "price_changed");
    // Online sales use today's price.
    await db.update(products).set({ basePrice: "100.00" }).where(eq(products.id, ids.a));
    await db.update(productVariants).set({ price: "100.00" }).where(eq(productVariants.id, ids.aVar));
  });

  it("an archived product sold offline is still recorded (and flagged)", async () => {
    await db.update(products).set({ status: "archived" }).where(eq(products.id, ids.a));
    const r = await offlineSale({});
    assert.equal(r.syncIssues, 1);
    const [issue] = await listSyncIssues(shop.id, { open: true });
    assert.equal(issue!.kind, "unavailable");
    await db.update(products).set({ status: "active" }).where(eq(products.id, ids.a));
  });

  it("tenders that don't cover the sale are still refused", async () => {
    await assert.rejects(offlineSale({ tenders: [{ method: "cash", amount: 50 }] }), (e: unknown) => e instanceof PosError && e.code === "BAD_TENDER");
  });

  it("a sale synced after its shift closed lands on that shift and fixes its variance", async () => {
    const summary = await getShiftSummary(shop.id, shiftId);
    const closed = await closeShift({ tenantId: shop.id, shiftId, counted: { ...summary!.expected, cash: summary!.expected.cash + 100 } });
    assert.equal(closed.variance!.cash, 100, "the drawer had ₱100 more than recorded");
    const r = await offlineSale({ rungAt: new Date(Date.now() - 5_000) });
    assert.equal(r.syncIssues, 1);
    const [s] = await db.select().from(registerSessions).where(eq(registerSessions.id, shiftId));
    assert.equal((s!.varianceJson as { cash: number }).cash, 0, "balanced once the offline sale arrived");
    const [issue] = await listSyncIssues(shop.id, { open: true });
    assert.equal(issue!.kind, "closed_shift");
    // Online sales can't use a closed shift.
    await assert.rejects(
      createPosSale({
        tenantId: shop.id,
        shiftId,
        staffId: null,
        userId: null,
        cashierName: "Tess",
        idempotencyKey: key(),
        items: [{ productId: ids.a, quantity: 1 }],
        discountType: "none",
        tenders: [{ method: "cash", amount: 100 }],
      }),
      (e: unknown) => e instanceof PosError && e.code === "SHIFT_CLOSED"
    );
  });

  it("after the Z reading: still saved, flagged as not in that Z", async () => {
    await createZReading(shop.id, registerId, "Tess");
    const r = await offlineSale({ rungAt: new Date(Date.now() - 5_000) });
    assert.equal(r.syncIssues, 2);
    const kinds = (await listSyncIssues(shop.id, { open: true })).slice(0, 2).map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["after_z", "closed_shift"]);
  });

  it("rejected sales are kept whole, once per key; issues resolve", async () => {
    const k = key();
    await recordRejectedOfflineSale({ tenantId: shop.id, idempotencyKey: k, reason: "Product deleted", sale: { items: [{ title: "Gone", quantity: 1 }] } });
    await recordRejectedOfflineSale({ tenantId: shop.id, idempotencyKey: k, reason: "Product deleted", sale: {} });
    const rejected = (await listSyncIssues(shop.id)).filter((i) => i.kind === "rejected");
    assert.equal(rejected.length, 1);
    assert.ok((rejected[0]!.detail as { items: unknown[] }).items.length === 1);
    const open = await countOpenSyncIssues(shop.id);
    assert.equal(await resolveSyncIssue(shop.id, rejected[0]!.id, "Tess"), true);
    assert.equal(await resolveSyncIssue(shop.id, rejected[0]!.id, "Tess"), false);
    assert.equal(await resolveSyncIssue(randomUUID(), rejected[0]!.id, "X"), false);
    assert.equal(await countOpenSyncIssues(shop.id), open - 1);
  });
});

describe("BIR invoice blocks", () => {
  it("are only for shops with BIR on", async () => {
    await assert.rejects(getOrReserveInvoiceBlock({ tenantId: shop.id, registerId, deviceId: DEVICE }), (e: unknown) => e instanceof PosOfflineError && e.code === "BIR_OFF");
  });

  it("reserve numbers off the counter; offline receipts keep their number; online sales skip the block", async () => {
    await db
      .update(tenants)
      .set({
        settingsJson: {
          pos: { bir: { enabled: true, registeredName: "Offline Shop", tin: "123-456-789-000", address: "Cebu City", min: "MIN1", serialNo: "SN1", ptuNo: "PTU-1", invoicePrefix: "or" } },
        } as never,
      })
      .where(eq(tenants.id, shop.id));
    shiftId = (await openShift({ tenantId: shop.id, registerId, openingCash: 0 })).id;
    const block = await getOrReserveInvoiceBlock({ tenantId: shop.id, registerId, deviceId: DEVICE, size: 5 });
    assert.equal(block.endNo - block.startNo, 4);
    assert.equal(block.from.startsWith("OR"), true);
    const same = await getOrReserveInvoiceBlock({ tenantId: shop.id, registerId, deviceId: DEVICE, size: 5 });
    assert.equal(same.id, block.id, "the same block until it's used up");

    const online = await createPosSale({
      tenantId: shop.id,
      shiftId,
      staffId: null,
      userId: null,
      cashierName: "Tess",
      idempotencyKey: key(),
      items: [{ productId: ids.a, quantity: 1 }],
      discountType: "none",
      tenders: [{ method: "cash", amount: 100 }],
    });
    assert.equal(online.invoiceNumber, `OR${String(block.endNo + 1).padStart(10, "0")}`, "online numbering continues after the block");

    const printed = block.from;
    const off = await offlineSale({ invoiceNumber: printed });
    assert.equal(off.invoiceNumber, printed);
    assert.equal(off.syncIssues, undefined);

    // Reused or foreign numbers are reassigned and flagged.
    const reused = await offlineSale({ invoiceNumber: printed });
    assert.notEqual(reused.invoiceNumber, printed);
    const foreign = await offlineSale({ invoiceNumber: "OR9999999999" });
    assert.notEqual(foreign.invoiceNumber, "OR9999999999");
    const other = await createPosSale({
      tenantId: shop.id,
      shiftId,
      staffId: null,
      userId: null,
      cashierName: "Tess",
      idempotencyKey: key(),
      items: [{ productId: ids.a, quantity: 1, unitPrice: 100 }],
      discountType: "none",
      tenders: [{ method: "cash", amount: 100 }],
      offline: { rungAt: new Date(), deviceId: "anotherdevice1", invoiceNumber: formatNo(block.startNo + 1) },
    });
    assert.notEqual(other.invoiceNumber, formatNo(block.startNo + 1), "another device can't use this device's block");
    const kinds = (await listSyncIssues(shop.id, { open: true })).slice(0, 3).map((i) => i.kind);
    assert.deepEqual(kinds, ["invoice_reassigned", "invoice_reassigned", "invoice_reassigned"]);

    // Used up → a new block when the device asks to replace it.
    const next = await getOrReserveInvoiceBlock({ tenantId: shop.id, registerId, deviceId: DEVICE, replaceBlockId: block.id, size: 5 });
    assert.notEqual(next.id, block.id);
    assert.ok(next.startNo > block.endNo);

    const list = await listInvoiceBlocks(shop.id);
    assert.equal(list.find((b) => b.id === block.id)!.used, 1);
    const released = await releaseInvoiceBlock(shop.id, next.id, "Tess");
    assert.ok(released.releasedAt);
    await assert.rejects(releaseInvoiceBlock(shop.id, next.id, "Tess"), (e: unknown) => e instanceof PosOfflineError);
    const fresh = await getOrReserveInvoiceBlock({ tenantId: shop.id, registerId, deviceId: DEVICE, size: 5 });
    assert.notEqual(fresh.id, next.id, "a released block is never handed out again");

    const csv = await posEJournalCsv(shop.id, new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));
    assert.ok(csv.split("\r\n")[0]!.endsWith("rung_offline"));
    assert.ok(csv.includes(`${printed},`));
  });
});

function formatNo(n: number) {
  return `OR${String(n).padStart(10, "0")}`;
}
