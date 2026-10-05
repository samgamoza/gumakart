/**
 * Phase 9 — variants & stock (local Postgres only).
 *   - options + variants save rules (reuse default, deactivate removed, ledger rows, base price = cheapest)
 *   - orders, POS sales and checkout links sell a specific variant at its price
 *   - stock counts and CSV import write ledger rows; other shops' rows are refused
 *   - the storefront catalog carries active variants
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { getProductVariantsForTenant, saveProductVariants, VariantError } from "./queries/variants";
import { createOrderForTenant, OrderError } from "./queries/orders";
import { createPosSale, ensureRegister, openShift, PosError } from "./queries/pos";
import { CheckoutLinkError, createCheckoutLink, getCheckoutLinkByCode } from "./queries/checkout-links";
import { updateProductForTenant } from "./queries/products";
import { getTenantStorefrontBySlug } from "./queries/storefront";
import {
  applyStockChanges,
  getLowStockSummary,
  InventoryError,
  inventoryToCsv,
  listInventory,
  parseCsv,
  planInventoryCsvImport,
} from "./queries/inventory";
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
const shop = { id: "", slug: `test-var-${run}` };
const other = { id: "", slug: `test-var2-${run}` };
const ids = { shirt: "", shirtDefault: "", mug: "", mugVariant: "", otherVariant: "" };
const variantOf: Record<string, string> = {};

async function addProduct(tenantId: string, title: string, price: string, stock: number, sku?: string) {
  const [p] = await db
    .insert(products)
    .values({ tenantId, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${run}`, status: "active", basePrice: price, trackInventory: true })
    .returning();
  const [v] = await db
    .insert(productVariants)
    .values({ productId: p!.id, title: "Default", price, stockQty: stock, sku: sku ?? null })
    .returning();
  return { productId: p!.id, variantId: v!.id };
}

async function variant(id: string) {
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, id));
  return v!;
}

before(async () => {
  const [a] = await db.insert(tenants).values({ slug: shop.slug, name: "Variant Shop", status: "active" }).returning();
  const [b] = await db.insert(tenants).values({ slug: other.slug, name: "Other Shop", status: "active" }).returning();
  shop.id = a!.id;
  other.id = b!.id;
  const shirt = await addProduct(shop.id, "Shirt", "300.00", 4);
  ids.shirt = shirt.productId;
  ids.shirtDefault = shirt.variantId;
  const mug = await addProduct(shop.id, "Mug", "150.00", 10, `MUG-${run}`);
  ids.mug = mug.productId;
  ids.mugVariant = mug.variantId;
  ids.otherVariant = (await addProduct(other.id, "Cap", "200.00", 5, `CAP-${run}`)).variantId;
});

after(async () => {
  const tids = [shop.id, other.id];
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
  await db.delete(locations).where(inArray(locations.tenantId, tids));
  await db.delete(checkoutLinks).where(inArray(checkoutLinks.tenantId, tids));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tids));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tids));
  await db.delete(tenants).where(inArray(tenants.id, tids));
  await closeDb();
});

const sizes = [{ name: "Size", values: ["S", "M", "L"] }];

describe("saving options and variants", () => {
  it("turns the default variant into the first size and adds the rest", async () => {
    const view = await saveProductVariants(shop.id, ids.shirt, {
      options: sizes,
      variants: [
        { id: ids.shirtDefault, options: { Size: "S" }, price: 280, stockQty: 4, sku: `SH-S-${run}` },
        { options: { Size: "M" }, price: 300, stockQty: 3, sku: `SH-M-${run}`, barcode: "4800000000011" },
        { options: { Size: "L" }, price: 320, stockQty: 0, sku: `SH-L-${run}` },
      ],
    });
    const active = view.variants.filter((v) => v.active);
    assert.equal(active.length, 3);
    assert.deepEqual(
      active.map((v) => v.title),
      ["S", "M", "L"]
    );
    assert.equal(active[0]!.id, ids.shirtDefault, "default variant reused");
    for (const v of active) variantOf[v.title] = v.id;

    const [p] = await db.select().from(products).where(eq(products.id, ids.shirt));
    assert.equal(Number(p!.basePrice), 280, "base price = cheapest variant");
    assert.equal(p!.optionsJson?.[0]?.name, "Size");

    const ledger = await db.select().from(stockMovements).where(eq(stockMovements.variantId, variantOf.M!));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]!.delta, 3);
  });

  it("rejects duplicates, missing values, SKU clashes and extra rows without options", async () => {
    await assert.rejects(
      saveProductVariants(shop.id, ids.shirt, {
        options: sizes,
        variants: [
          { options: { Size: "S" }, price: 1, stockQty: 0 },
          { options: { Size: "s" }, price: 1, stockQty: 0 },
        ],
      }),
      (e: unknown) => e instanceof VariantError && /listed twice/.test(e.message)
    );
    await assert.rejects(
      saveProductVariants(shop.id, ids.shirt, { options: sizes, variants: [{ options: { Size: "XL" }, price: 1, stockQty: 0 }] }),
      (e: unknown) => e instanceof VariantError && /Pick a Size/.test(e.message)
    );
    await assert.rejects(
      saveProductVariants(shop.id, ids.shirt, {
        options: sizes,
        variants: [{ id: variantOf.S, options: { Size: "S" }, price: 1, stockQty: 0, sku: `MUG-${run}` }],
      }),
      (e: unknown) => e instanceof VariantError && /already used/.test(e.message)
    );
    await assert.rejects(
      saveProductVariants(shop.id, ids.shirt, {
        options: [],
        variants: [
          { options: {}, price: 1, stockQty: 0 },
          { options: {}, price: 2, stockQty: 0 },
        ],
      }),
      (e: unknown) => e instanceof VariantError
    );
    await assert.rejects(
      saveProductVariants(other.id, ids.shirt, { options: [], variants: [{ options: {}, price: 1, stockQty: 0 }] }),
      (e: unknown) => e instanceof VariantError && /not found/.test(e.message)
    );
  });

  it("a removed size is turned off, not deleted", async () => {
    const tmp = await saveProductVariants(shop.id, ids.shirt, {
      options: [{ name: "Size", values: ["S", "M", "L", "XL"] }],
      variants: [
        { id: variantOf.S, options: { Size: "S" }, price: 280, stockQty: 4 },
        { id: variantOf.M, options: { Size: "M" }, price: 300, stockQty: 3 },
        { id: variantOf.L, options: { Size: "L" }, price: 320, stockQty: 0 },
        { options: { Size: "XL" }, price: 340, stockQty: 1 },
      ],
    });
    const xl = tmp.variants.find((v) => v.title === "XL")!;
    await saveProductVariants(shop.id, ids.shirt, {
      options: sizes,
      variants: [
        { id: variantOf.S, options: { Size: "S" }, price: 280, stockQty: 4 },
        { id: variantOf.M, options: { Size: "M" }, price: 300, stockQty: 3 },
        { id: variantOf.L, options: { Size: "L" }, price: 320, stockQty: 0 },
      ],
    });
    const row = await variant(xl.id);
    assert.equal(row.active, false);
    const view = await getProductVariantsForTenant(shop.id, ids.shirt);
    assert.equal(view!.variants.filter((v) => v.active).length, 3);
  });

  it("product edits don't overwrite variant prices for products with options", async () => {
    await updateProductForTenant(shop.id, ids.shirt, { basePrice: "999.00", stockQty: 50 });
    const [p] = await db.select().from(products).where(eq(products.id, ids.shirt));
    assert.equal(Number(p!.basePrice), 280);
    assert.equal((await variant(variantOf.S!)).stockQty, 4);
  });
});

describe("selling a variant", () => {
  it("online orders need a size and charge that size's price", async () => {
    await assert.rejects(
      createOrderForTenant({
        tenantSlug: shop.slug,
        items: [{ productId: ids.shirt, quantity: 1 }],
        customer: { name: "Buyer", phone: "09170003333" },
        deliveryType: "pickup",
        paymentMethod: "cod",
        deliveryFee: 0,
        minOrderAmount: 0,
      }),
      (e: unknown) => e instanceof OrderError && /Pick a size/.test(e.message)
    );
    const order = await createOrderForTenant({
      tenantSlug: shop.slug,
      items: [
        { productId: ids.shirt, variantId: variantOf.M, quantity: 2 },
        { productId: ids.shirt, variantId: variantOf.S, quantity: 1 },
      ],
      customer: { name: "Buyer", phone: "09170003333" },
      deliveryType: "pickup",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
    });
    assert.equal(Number(order.subtotal), 300 * 2 + 280);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    assert.equal(lines.length, 2);
    assert.ok(lines.some((l) => l.titleSnapshot === "Shirt (M)" && l.quantity === 2));
    assert.equal((await variant(variantOf.M!)).stockQty, 1);
    assert.equal((await variant(variantOf.S!)).stockQty, 3);
  });

  it("a sold-out size can't be ordered", async () => {
    await assert.rejects(
      createOrderForTenant({
        tenantSlug: shop.slug,
        items: [{ productId: ids.shirt, variantId: variantOf.L, quantity: 1 }],
        customer: { name: "Buyer", phone: "09170003333" },
        deliveryType: "pickup",
        paymentMethod: "cod",
        deliveryFee: 0,
        minOrderAmount: 0,
      })
    );
  });

  it("POS sells a variant at its price", async () => {
    const register = await ensureRegister(shop.id);
    const shift = await openShift({ tenantId: shop.id, registerId: register.id, openingCash: 0 });
    const base = {
      tenantId: shop.id,
      shiftId: shift.id,
      staffId: null,
      userId: null,
      cashierName: "Owner",
      discountType: "none" as const,
      tenders: [{ method: "cash" as const, amount: 1000 }],
    };
    await assert.rejects(
      createPosSale({ ...base, idempotencyKey: randomUUID().replace(/-/g, ""), items: [{ productId: ids.shirt, quantity: 1 }] }),
      (e: unknown) => e instanceof PosError && /Pick a size/.test(e.message)
    );
    const sale = await createPosSale({
      ...base,
      idempotencyKey: randomUUID().replace(/-/g, ""),
      items: [{ productId: ids.shirt, variantId: variantOf.S, quantity: 1 }],
    });
    assert.equal(sale.totals.total, 280);
    assert.equal((await variant(variantOf.S!)).stockQty, 2);
  });

  it("checkout links pin a variant and show its price", async () => {
    await assert.rejects(
      createCheckoutLink(shop.id, null, { items: [{ productId: ids.shirt, quantity: 1 }] }),
      (e: unknown) => e instanceof CheckoutLinkError && /Pick a size/.test(e.message)
    );
    const link = await createCheckoutLink(shop.id, null, {
      items: [
        { productId: ids.shirt, variantId: variantOf.M, quantity: 1 },
        { productId: ids.mug, quantity: 1 },
      ],
    });
    const pub = await getCheckoutLinkByCode(link.code);
    const shirtLine = pub!.items.find((i) => i.productId === ids.shirt)!;
    assert.equal(shirtLine.variantId, variantOf.M);
    assert.equal(shirtLine.variantTitle, "M");
    assert.equal(Number(shirtLine.price), 300);
    const mugLine = pub!.items.find((i) => i.productId === ids.mug)!;
    assert.equal(Number(mugLine.price), 150);
    assert.equal(mugLine.variantTitle, null);
  });

  it("the storefront catalog carries active variants in order", async () => {
    const store = await getTenantStorefrontBySlug(shop.slug);
    const shirt = store!.products.find((p) => p.id === ids.shirt)!;
    assert.deepEqual(
      shirt.variants.map((v) => v.title),
      ["S", "M", "L"]
    );
    assert.equal(shirt.variants.find((v) => v.title === "L")!.available, false);
    assert.equal(shirt.options[0]!.name, "Size");
    const mug = store!.products.find((p) => p.id === ids.mug)!;
    assert.equal(mug.variants.length, 0, "simple products carry no variant list");
  });
});

describe("stock tools", () => {
  it("a stock count sets numbers and logs the difference", async () => {
    const result = await applyStockChanges(
      shop.id,
      [
        { variantId: ids.mugVariant, stockQty: 7 },
        { variantId: variantOf.L!, stockQty: 0 },
      ],
      { note: "Stock count" }
    );
    assert.deepEqual(result, { changed: 1, unchanged: 1 });
    assert.equal((await variant(ids.mugVariant)).stockQty, 7);
    const [last] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.variantId, ids.mugVariant), eq(stockMovements.reason, "adjustment")));
    assert.equal(last!.delta, -3);
    assert.equal(last!.note, "Stock count");
  });

  it("refuses another shop's variant and writes nothing", async () => {
    await assert.rejects(
      applyStockChanges(
        shop.id,
        [
          { variantId: ids.mugVariant, stockQty: 99 },
          { variantId: ids.otherVariant, stockQty: 1 },
        ],
        { note: "x" }
      ),
      (e: unknown) => e instanceof InventoryError
    );
    assert.equal((await variant(ids.mugVariant)).stockQty, 7);
    assert.equal((await variant(ids.otherVariant)).stockQty, 5);
  });

  it("CSV round-trip: export, edit, plan, apply", async () => {
    const csv = inventoryToCsv(await listInventory(shop.id));
    const table = parseCsv(csv);
    assert.deepEqual(table[0], ["product", "product_slug", "variant", "sku", "barcode", "price", "stock"]);
    assert.equal(table.length, 1 + 4, "3 shirt sizes + mug");

    const edited = [
      "sku,product_slug,variant,price,stock",
      `MUG-${run},,,160,12`,
      `,shirt-${run},M,"300",5`,
      `NOPE-${run},,,1,1`,
      `CAP-${run},,,1,1`,
      `,shirt-${run},L,320,abc`,
    ].join("\n");
    const plan = await planInventoryCsvImport(shop.id, edited);
    assert.equal(plan.changes.length, 2);
    assert.equal(plan.skipped.length, 3, "unknown SKU, other shop's SKU, bad stock");
    const mug = plan.changes.find((c) => c.variantId === ids.mugVariant)!;
    assert.equal(mug.stockQty, 12);
    assert.equal(mug.price, 160);
    const m = plan.changes.find((c) => c.variantId === variantOf.M)!;
    assert.equal(m.stockQty, 5);
    assert.equal(m.price, undefined, "unchanged price is left alone");

    await applyStockChanges(shop.id, plan.changes, { note: "CSV import" });
    assert.equal((await variant(ids.mugVariant)).stockQty, 12);
    const [mugProduct] = await db.select().from(products).where(eq(products.id, ids.mug));
    assert.equal(Number(mugProduct!.basePrice), 160, "simple product's base price follows");
  });

  it("CSV cells that look like formulas are neutralised", () => {
    const csv = inventoryToCsv([
      {
        productId: "x",
        productTitle: "=HYPERLINK(\"http://x\")",
        productSlug: "x",
        productStatus: "active",
        hasOptions: false,
        variantId: "x",
        variantTitle: null,
        sku: "-5",
        barcode: null,
        price: "1.00",
        stockQty: 1,
      },
    ]);
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /,-5,/);
  });

  it("low-stock summary uses the shop's threshold", async () => {
    const summary = await getLowStockSummary(shop.id);
    assert.equal(summary.threshold, 3);
    // S = 2, L = 0 (M = 5, mug = 12)
    assert.equal(summary.lowCount, 2);
    assert.equal(summary.soldOutCount, 1);
    assert.equal(summary.items[0]!.title, "Shirt (L)");
    await db.update(tenants).set({ settingsJson: { inventory: { lowStockThreshold: 0 } } as never }).where(eq(tenants.id, shop.id));
    assert.equal((await getLowStockSummary(shop.id)).lowCount, 1);
  });
});
