/**
 * Phase 12 — Guma ID (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  createBuyerOtp,
  deleteBuyerAccount,
  deleteBuyerAddress,
  exportBuyerData,
  GumaIdError,
  linkOrderToBuyer,
  listBuyerAddresses,
  listBuyerOrders,
  listBuyerShops,
  normalizeBuyerPhone,
  saveBuyerAddress,
  setBuyerShopReminders,
  verifyBuyerOtp,
  type BuyerAccount,
} from "./queries/guma-id";
import { isOptedOut } from "./queries/message-log";
import { createOrderForTenant } from "./queries/orders";
import {
  buyerAccounts,
  buyerOtpCodes,
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
  stockMovements,
  tenants,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 6);
const SECRET = "test-secret-that-is-long-enough-0123456789";
// A number unique to this run: 0917 + 7 digits.
const phone = `0917${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const other = `0918${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const shops = [
  { id: "", slug: `test-gid-a-${run}`, product: "" },
  { id: "", slug: `test-gid-b-${run}`, product: "" },
];
let buyer: BuyerAccount;

async function latestCodeFor(_p: string, secretCode: string) {
  // Tests know the code because createBuyerOtp returns it (the app texts it).
  return secretCode;
}

before(async () => {
  for (const s of shops) {
    const [t] = await db.insert(tenants).values({ slug: s.slug, name: `Shop ${s.slug.slice(-1)}`, status: "active" }).returning();
    s.id = t!.id;
    const [p] = await db.insert(products).values({ tenantId: s.id, title: "Item", slug: `item-${run}`, status: "active", basePrice: "50.00", trackInventory: false }).returning();
    await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "50.00", stockQty: 0 });
    s.product = p!.id;
  }
});

after(async () => {
  const tids = shops.map((s) => s.id);
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tids));
  await db.delete(messagingOptOuts).where(inArray(messagingOptOuts.phone, [phone, other]));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tids));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tids));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tids));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tids));
  await db.delete(customers).where(inArray(customers.tenantId, tids));
  await db.delete(locations).where(inArray(locations.tenantId, tids));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tids));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tids));
  await db.delete(tenants).where(inArray(tenants.id, tids));
  await db.delete(buyerOtpCodes).where(inArray(buyerOtpCodes.phone, [phone, other]));
  await db.delete(buyerAccounts).where(inArray(buyerAccounts.phone, [phone, other]));
  await closeDb();
});

describe("phone numbers", () => {
  it("normalises PH mobiles and rejects others", () => {
    assert.equal(normalizeBuyerPhone("+63 917 123 4567"), "09171234567");
    assert.equal(normalizeBuyerPhone("639171234567"), "09171234567");
    assert.equal(normalizeBuyerPhone("9171234567"), "09171234567");
    assert.equal(normalizeBuyerPhone("0917-123-4567"), "09171234567");
    assert.equal(normalizeBuyerPhone("02 8123 4567"), null);
    assert.equal(normalizeBuyerPhone(""), null);
  });
});

describe("sign in by text code", () => {
  it("creates the account on first verified code; stores only a hash", async () => {
    const otp = await createBuyerOtp(phone, SECRET, "1.2.3.4");
    assert.match(otp.code, /^\d{6}$/);
    const [row] = await db.select().from(buyerOtpCodes).where(eq(buyerOtpCodes.phone, phone));
    assert.notEqual(row!.codeHash, otp.code);
    assert.equal(row!.codeHash.length, 64);
    const res = await verifyBuyerOtp(phone, await latestCodeFor(phone, otp.code), SECRET);
    assert.equal(res.isNew, true);
    assert.equal(res.buyer.phone, phone);
    buyer = res.buyer;
    // The same code can't be used twice.
    await assert.rejects(verifyBuyerOtp(phone, otp.code, SECRET), (e: unknown) => e instanceof GumaIdError);
  });

  it("wrong codes count; the 5th wrong try locks the code", async () => {
    const otp = await createBuyerOtp(phone, SECRET);
    const wrong = otp.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      await assert.rejects(verifyBuyerOtp(phone, wrong, SECRET), (e: unknown) => e instanceof GumaIdError && e.code === "BAD_CODE");
    }
    await assert.rejects(verifyBuyerOtp(phone, wrong, SECRET), (e: unknown) => e instanceof GumaIdError && e.code === "TOO_MANY_TRIES");
    await assert.rejects(verifyBuyerOtp(phone, otp.code, SECRET), (e: unknown) => e instanceof GumaIdError && e.code === "TOO_MANY_TRIES");
  });

  it("limits codes per number and expires them", async () => {
    // 2 codes created so far in 15 minutes; a 3rd is fine, the 4th is refused.
    const third = await createBuyerOtp(phone, SECRET);
    await assert.rejects(createBuyerOtp(phone, SECRET), (e: unknown) => e instanceof GumaIdError && e.code === "RATE_LIMITED");
    await db.update(buyerOtpCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(buyerOtpCodes.phone, phone));
    await assert.rejects(verifyBuyerOtp(phone, third.code, SECRET), (e: unknown) => e instanceof GumaIdError && e.code === "CODE_EXPIRED");
    // A different secret can never verify (keyed hash).
    const o = await createBuyerOtp(other, SECRET);
    await assert.rejects(verifyBuyerOtp(other, o.code, "another-secret-that-is-long-enough-xx"), (e: unknown) => e instanceof GumaIdError && e.code === "BAD_CODE");
  });
});

describe("addresses", () => {
  it("first address becomes default; limit; delete moves the default", async () => {
    let list = await saveBuyerAddress(buyer.id, { label: "Bahay", address: { line1: "12 Rizal St.", city: "Cebu City", province: "Cebu", barangay: "Lahug" } });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.isDefault, true);
    list = await saveBuyerAddress(buyer.id, { label: "Opisina", address: { line1: "IT Park Tower 1", city: "Cebu City" }, makeDefault: true });
    assert.equal(list.find((a) => a.label === "Opisina")!.isDefault, true);
    assert.equal(list.filter((a) => a.isDefault).length, 1);
    await assert.rejects(saveBuyerAddress(buyer.id, { address: { line1: "x", city: "" } }), (e: unknown) => e instanceof GumaIdError && e.code === "INVALID");
    const office = list.find((a) => a.label === "Opisina")!;
    list = await deleteBuyerAddress(buyer.id, office.id);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.isDefault, true);
    // Someone else's address id does nothing.
    assert.equal((await deleteBuyerAddress(randomUUID(), list[0]!.id)).length, 0);
    assert.equal((await listBuyerAddresses(buyer.id)).length, 1);
  });
});

describe("orders across shops", () => {
  it("finds orders with the verified number in every shop, not others' orders", async () => {
    const mine = [];
    for (const s of shops) {
      mine.push(
        await createOrderForTenant({
          tenantSlug: s.slug,
          items: [{ productId: s.product, quantity: 1 }],
          customer: { name: "Me", phone: `+63${phone.slice(1)}` },
          deliveryType: "pickup",
          paymentMethod: "cod",
          deliveryFee: 0,
          minOrderAmount: 0,
        })
      );
    }
    const theirs = await createOrderForTenant({
      tenantSlug: shops[0]!.slug,
      items: [{ productId: shops[0]!.product, quantity: 1 }],
      customer: { name: "Other", phone: other },
      deliveryType: "pickup",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
    });
    const list = await listBuyerOrders(buyer);
    assert.equal(list.length, 2);
    assert.deepEqual(new Set(list.map((o) => o.shopSlug)), new Set(shops.map((s) => s.slug)));
    assert.ok(list.every((o) => o.orderPath?.includes("?t=")));
    assert.equal(await linkOrderToBuyer(mine[0]!.id, buyer), true);
    assert.equal(await linkOrderToBuyer(theirs.id, buyer), false, "never links someone else's order");
    const [linked] = await db.select({ b: orders.buyerAccountId }).from(orders).where(eq(orders.id, mine[0]!.id));
    assert.equal(linked!.b, buyer.id);
  });

  it("reminder texts can be turned off per shop", async () => {
    let shopsList = await listBuyerShops(buyer);
    assert.equal(shopsList.length, 2);
    assert.ok(shopsList.every((s) => !s.remindersOff));
    await setBuyerShopReminders(buyer, shops[0]!.id, false);
    await setBuyerShopReminders(buyer, shops[0]!.id, false);
    assert.equal(await isOptedOut(phone, { kind: "marketing", tenantId: shops[0]!.id }), true);
    assert.equal(await isOptedOut(phone, { kind: "marketing", tenantId: shops[1]!.id }), false);
    shopsList = await listBuyerShops(buyer);
    assert.equal(shopsList.find((s) => s.tenantId === shops[0]!.id)!.remindersOff, true);
    await setBuyerShopReminders(buyer, shops[0]!.id, true);
    assert.equal(await isOptedOut(phone, { kind: "marketing", tenantId: shops[0]!.id }), false);
  });
});

describe("privacy", () => {
  it("export has everything; delete removes the account and unlinks orders", async () => {
    const data = (await exportBuyerData(buyer.id)) as { account: { phone: string }; addresses: unknown[]; orders: unknown[] };
    assert.equal(data.account.phone, phone);
    assert.equal(data.addresses.length, 1);
    assert.equal(data.orders.length, 2);
    await deleteBuyerAccount(buyer.id);
    assert.equal((await db.select().from(buyerAccounts).where(eq(buyerAccounts.id, buyer.id))).length, 0);
    assert.equal((await db.select().from(orders).where(eq(orders.buyerAccountId, buyer.id))).length, 0);
    const shopOrders = await db.select().from(orders).where(inArray(orders.tenantId, shops.map((s) => s.id)));
    assert.equal(shopOrders.length, 3, "shops keep their orders");
    assert.equal((await db.select().from(buyerOtpCodes).where(eq(buyerOtpCodes.phone, phone))).length, 0);
  });
});
