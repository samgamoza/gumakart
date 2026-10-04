/**
 * Phase 3 — checkout links (local Postgres only, same rule as phase2.test.ts).
 *   - create: own active products only, default variant, duplicates merged
 *   - payment/delivery limited to what the shop offers; "all methods" stored as null
 *   - status: live / off / expired / sold_out
 *   - tenant isolation on read and update
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  CheckoutLinkError,
  checkoutLinkStatus,
  createCheckoutLink,
  generateCheckoutLinkCode,
  getCheckoutLinkForTenant,
  isCheckoutLinkCode,
  listCheckoutLinksForTenant,
  resolveCheckoutLinkShopOptions,
  updateCheckoutLink,
} from "./queries/checkout-links";
import { createOrderForTenant, OrderError } from "./queries/orders";
import {
  checkoutLinks,
  customers,
  domainEvents,
  locations,
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
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-cl-${run}` };
const other = { id: "", slug: `test-cl-other-${run}` };
const ids = { mug: "", bag: "", draft: "", foreign: "", mugVariant: "" };

async function addProduct(tenantId: string, title: string, status: "active" | "draft", price: string) {
  const [p] = await db
    .insert(products)
    .values({ tenantId, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${run}`, status, basePrice: price })
    .returning();
  const [v] = await db
    .insert(productVariants)
    .values({ productId: p!.id, title, price, stockQty: 10 })
    .returning();
  return { productId: p!.id, variantId: v!.id };
}

before(async () => {
  const [a] = await db
    .insert(tenants)
    .values({ slug: shop.slug, name: "Link Shop", status: "active", settingsJson: { payments: { receiving: { gcashNumber: "09171234567" } } } as never })
    .returning();
  const [b] = await db.insert(tenants).values({ slug: other.slug, name: "Other Shop" }).returning();
  shop.id = a!.id;
  other.id = b!.id;
  const mug = await addProduct(shop.id, "Mug", "active", "349.00");
  ids.mug = mug.productId;
  ids.mugVariant = mug.variantId;
  ids.bag = (await addProduct(shop.id, "Bag", "active", "1290.00")).productId;
  ids.draft = (await addProduct(shop.id, "Shades", "draft", "650.00")).productId;
  ids.foreign = (await addProduct(other.id, "Not yours", "active", "10.00")).productId;
});

after(async () => {
  const shopOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, shop.id));
  await db.delete(domainEvents).where(eq(domainEvents.tenantId, shop.id));
  await db.delete(stockMovements).where(eq(stockMovements.tenantId, shop.id));
  await db.delete(paymentTransactions).where(eq(paymentTransactions.tenantId, shop.id));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(eq(orders.tenantId, shop.id));
  await db.delete(customers).where(eq(customers.tenantId, shop.id));
  await db.delete(locations).where(eq(locations.tenantId, shop.id));
  await db.delete(checkoutLinks).where(inArray(checkoutLinks.tenantId, [shop.id, other.id]));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, [shop.id, other.id]));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, [shop.id, other.id]));
  await db.delete(tenants).where(inArray(tenants.id, [shop.id, other.id]));
  await closeDb();
});

describe("codes", () => {
  it("are 7 chars from an unambiguous alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCheckoutLinkCode();
      assert.ok(isCheckoutLinkCode(code), code);
      assert.doesNotMatch(code, /[01ilo]/);
    }
    assert.equal(isCheckoutLinkCode("ABCDEFG"), false);
    assert.equal(isCheckoutLinkCode("abc"), false);
  });
});

describe("shop options", () => {
  it("defaults: GCash, Maya, COD; pickup on; Maya flagged until a number is saved", () => {
    const opts = resolveCheckoutLinkShopOptions({
      settingsJson: { payments: { receiving: { gcashNumber: "0917" } } },
      checkoutPublishedJson: null,
      shippingPublishedJson: null,
    });
    assert.deepEqual(opts.paymentMethods.map((m) => m.id), ["gcash", "paymaya", "cod"]);
    assert.equal(opts.paymentMethods.find((m) => m.id === "gcash")!.needsSetup, false);
    assert.equal(opts.paymentMethods.find((m) => m.id === "paymaya")!.needsSetup, true);
    assert.equal(opts.deliveryEnabled, true);
  });

  it("COD off in the published checkout removes it", () => {
    const opts = resolveCheckoutLinkShopOptions({
      settingsJson: {},
      checkoutPublishedJson: { codEnabled: false, paymentAdapters: { cod: false } },
      shippingPublishedJson: null,
    });
    assert.ok(!opts.paymentMethods.some((m) => m.id === "cod"));
  });
});

describe("create", () => {
  it("uses the product's variant, merges duplicates, names it after the products", async () => {
    const link = await createCheckoutLink(shop.id, null, {
      items: [
        { productId: ids.mug, quantity: 2 },
        { productId: ids.bag, quantity: 1 },
        { productId: ids.mug, quantity: 1 },
      ],
      shareChannel: "facebook",
    });
    assert.ok(isCheckoutLinkCode(link.code));
    assert.equal(link.title, "Mug + 1 more");
    assert.equal(link.items.length, 2);
    assert.equal(link.items[0]!.productId, ids.mug);
    assert.equal(link.items[0]!.variantId, ids.mugVariant);
    assert.equal(link.items[0]!.quantity, 3);
    assert.equal(link.items[0]!.price, "349.00");
    assert.equal(link.status, "live");
    assert.equal(link.paymentMethods, null, "no subset given = all methods");
    assert.equal(link.shareChannel, "facebook");
  });

  it("rejects drafts, other shops' products and empty lists", async () => {
    await assert.rejects(
      createCheckoutLink(shop.id, null, { items: [{ productId: ids.draft, quantity: 1 }] }),
      (e: unknown) => e instanceof CheckoutLinkError && /Publish these products first: Shades/.test(e.message)
    );
    await assert.rejects(
      createCheckoutLink(shop.id, null, { items: [{ productId: ids.foreign, quantity: 1 }] }),
      (e: unknown) => e instanceof CheckoutLinkError && e.code === "INVALID_PRODUCTS"
    );
    await assert.rejects(createCheckoutLink(shop.id, null, { items: [] }), CheckoutLinkError);
  });

  it("keeps only payment methods the shop accepts; all of them collapses to null", async () => {
    const subset = await createCheckoutLink(shop.id, null, {
      items: [{ productId: ids.bag, quantity: 1 }],
      paymentMethods: ["cod", "card"],
    });
    assert.deepEqual(subset.paymentMethods, ["cod"]);

    const all = await createCheckoutLink(shop.id, null, {
      items: [{ productId: ids.bag, quantity: 1 }],
      paymentMethods: ["gcash", "paymaya", "cod"],
    });
    assert.equal(all.paymentMethods, null);

    await assert.rejects(
      createCheckoutLink(shop.id, null, { items: [{ productId: ids.bag, quantity: 1 }], paymentMethods: ["card"] }),
      (e: unknown) => e instanceof CheckoutLinkError && e.code === "NO_PAYMENT_METHOD"
    );
  });
});

describe("status and updates", () => {
  it("live → off → expired → order limit", () => {
    const base = { active: true, expiresAt: null, maxOrders: null, orderCount: 0 };
    assert.equal(checkoutLinkStatus(base), "live");
    assert.equal(checkoutLinkStatus({ ...base, active: false }), "off");
    assert.equal(checkoutLinkStatus({ ...base, expiresAt: new Date(Date.now() - 1000) }), "expired");
    assert.equal(checkoutLinkStatus({ ...base, maxOrders: 5, orderCount: 5 }), "sold_out");
    assert.equal(checkoutLinkStatus({ ...base, maxOrders: 5, orderCount: 4 }), "live");
  });

  it("turning a link off and on; other shops can't read or change it", async () => {
    const link = await createCheckoutLink(shop.id, null, { items: [{ productId: ids.mug, quantity: 1 }] });
    const off = await updateCheckoutLink(shop.id, link.id, { active: false });
    assert.equal(off!.status, "off");
    assert.equal(await updateCheckoutLink(other.id, link.id, { active: true }), null);
    assert.equal(await getCheckoutLinkForTenant(other.id, link.id), null);
    const [stillOff] = await db.select().from(checkoutLinks).where(eq(checkoutLinks.id, link.id));
    assert.equal(stillOff!.active, false);
    const on = await updateCheckoutLink(shop.id, link.id, { active: true, title: "  Payday post  " });
    assert.equal(on!.status, "live");
    assert.equal(on!.title, "Payday post");
  });

  it("lists only this shop's links, newest first", async () => {
    const mine = await listCheckoutLinksForTenant(shop.id);
    assert.ok(mine.length >= 4);
    assert.ok(mine.every((l, i) => i === 0 || mine[i - 1]!.createdAt >= l.createdAt));
    assert.deepEqual(await listCheckoutLinksForTenant(other.id), []);
  });
});

describe("orders through a link", () => {
  function order(linkId: string, phone: string) {
    return createOrderForTenant({
      tenantSlug: shop.slug,
      items: [{ productId: ids.mug, quantity: 1 }],
      customer: { name: "Link Buyer", phone },
      deliveryType: "pickup",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
      sourceChannel: "checkout_link",
      checkoutLinkId: linkId,
      utmJson: { utm_source: "facebook" },
    });
  }

  it("records the link and UTM on the order and counts it", async () => {
    const link = await createCheckoutLink(shop.id, null, { items: [{ productId: ids.mug, quantity: 1 }] });
    const created = await order(link.id, "09170000001");
    const [row] = await db.select().from(orders).where(eq(orders.id, created.id));
    assert.equal(row!.checkoutLinkId, link.id);
    assert.equal(row!.sourceChannel, "checkout_link");
    assert.deepEqual(row!.utmJson, { utm_source: "facebook" });
    const after = await getCheckoutLinkForTenant(shop.id, link.id);
    assert.equal(after!.orderCount, 1);
    assert.equal(after!.salesTotal, 349);
  });

  it("never goes over the order limit, even with simultaneous buyers", async () => {
    const link = await createCheckoutLink(shop.id, null, { items: [{ productId: ids.mug, quantity: 1 }], maxOrders: 2 });
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => order(link.id, `0917000010${n}`)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const closed = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof OrderError && r.reason.code === "LINK_CLOSED"
    ).length;
    assert.equal(ok, 2);
    assert.equal(closed, 2);
    const after = await getCheckoutLinkForTenant(shop.id, link.id);
    assert.equal(after!.orderCount, 2);
    assert.equal(after!.status, "sold_out");
  });

  it("a link turned off refuses new orders", async () => {
    const link = await createCheckoutLink(shop.id, null, { items: [{ productId: ids.mug, quantity: 1 }] });
    await updateCheckoutLink(shop.id, link.id, { active: false });
    await assert.rejects(order(link.id, "09170000201"), (e: unknown) => e instanceof OrderError && e.code === "LINK_CLOSED");
    // no order row left behind by the rolled-back attempt
    const left = await db.select({ id: orders.id }).from(orders).where(eq(orders.checkoutLinkId, link.id));
    assert.equal(left.length, 0);
  });
});
