/**
 * Phase 18 — agency partners (access grants, referrals, the per-request check) and
 * platform v1.1 product writes + product webhooks (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  PartnerError,
  createPartnerProfile,
  getShopPartner,
  grantPartnerAccess,
  listPartnerShops,
  listPartnersForOps,
  lookupPartnerCode,
  normalizePartnerCode,
  recordPartnerReferral,
  revokePartnerAccess,
  setPartnerStatus,
  verifyPartnerAccess,
} from "./queries/partners";
import { ApiInputError, apiCreateProduct, apiGetProduct, apiUpdateProduct, apiUpdateVariant } from "./queries/public-api";
import { createWebhookEndpoint, fanOutWebhookEvents } from "./queries/developer";
import { createOrderForTenant } from "./queries/orders";
import { saveProductVariants } from "./queries/variants";
import {
  activityLog,
  customers,
  domainEvents,
  orderItems,
  orderStatusHistory,
  orders,
  partnerShops,
  partners,
  paymentTransactions,
  productVariants,
  products,
  stockMovements,
  tenants,
  users,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shopA = { id: "", slug: `test-pa-${run}` };
const shopB = { id: "", slug: `test-pb-${run}` };
const owner = { id: "" };
const agency = { userId: "", id: "", code: "" };
const rival = { userId: "", id: "", code: "" };
let soapId = "";

async function partnerUser(tag: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `partner-${tag}-${run}@example.com`, role: "partner", profileJson: { displayName: `Agent ${tag}` } })
    .returning({ id: users.id });
  return u!.id;
}

before(async () => {
  const [a] = await db.insert(tenants).values({ slug: shopA.slug, name: "Shop A", status: "active" }).returning();
  const [b] = await db.insert(tenants).values({ slug: shopB.slug, name: "Shop B", status: "active", subscriptionPlan: "growth" }).returning();
  shopA.id = a!.id;
  shopB.id = b!.id;
  const [o] = await db.insert(users).values({ email: `owner-${run}@example.com`, role: "seller_owner", tenantId: shopA.id }).returning({ id: users.id });
  owner.id = o!.id;
  agency.userId = await partnerUser("a");
  rival.userId = await partnerUser("r");
  const p1 = await createPartnerProfile({ userId: agency.userId, name: "Bida Digital", contactEmail: `bida-${run}@example.com`, city: "Cebu" });
  const p2 = await createPartnerProfile({ userId: rival.userId, name: "Rival Co", contactEmail: `rival-${run}@example.com` });
  Object.assign(agency, { id: p1.id, code: p1.code });
  Object.assign(rival, { id: p2.id, code: p2.code });
  const [s] = await db
    .insert(products)
    .values({ tenantId: shopA.id, title: "Soap", slug: `soap-${run}`, status: "active", basePrice: "100.00", trackInventory: true })
    .returning();
  await db.insert(productVariants).values({ productId: s!.id, title: "Default", price: "100.00", stockQty: 50 });
  soapId = s!.id;
});

after(async () => {
  const tid = [shopA.id, shopB.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.tenantId, tid));
  await db.delete(webhookEvents).where(inArray(webhookEvents.tenantId, tid));
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.tenantId, tid));
  await db.delete(activityLog).where(inArray(activityLog.tenantId, tid));
  await db.delete(domainEvents).where(inArray(domainEvents.tenantId, tid));
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid));
  await db.delete(paymentTransactions).where(inArray(paymentTransactions.tenantId, tid));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(inArray(orders.tenantId, tid));
  await db.delete(customers).where(inArray(customers.tenantId, tid));
  await db.delete(partnerShops).where(inArray(partnerShops.tenantId, tid));
  await db.update(tenants).set({ referredByPartnerId: null }).where(inArray(tenants.id, tid));
  await db.delete(partners).where(inArray(partners.id, [agency.id, rival.id]));
  await db.delete(users).where(inArray(users.id, [owner.id, agency.userId, rival.userId]));
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tid));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(inArray(products.tenantId, tid));
  await db.delete(tenants).where(inArray(tenants.id, tid));
  await closeDb();
});

describe("partner codes and referrals", () => {
  it("codes look like P-XXXXXX and normalise", () => {
    assert.match(agency.code, /^P-[A-Z0-9]{6}$/);
    assert.equal(normalizePartnerCode(agency.code.toLowerCase().replace("-", " ")), agency.code);
    assert.equal(normalizePartnerCode(agency.code.slice(2)), agency.code);
    assert.equal(normalizePartnerCode("nope"), null);
  });
  it("records a referral once, ignores unknown and suspended codes", async () => {
    assert.equal(await recordPartnerReferral(shopB.id, "P-ZZZZZZ"), false);
    assert.equal(await recordPartnerReferral(shopB.id, agency.code), true);
    assert.equal(await recordPartnerReferral(shopB.id, rival.code), false, "first referral sticks");
    const [t] = await db.select({ ref: tenants.referredByPartnerId }).from(tenants).where(eq(tenants.id, shopB.id));
    assert.equal(t!.ref, agency.id);
    const shops = await listPartnerShops(agency.id);
    const b = shops.find((s) => s.tenantId === shopB.id)!;
    assert.equal(b.role, null, "a referral alone gives no access");
    assert.equal(b.stats, null, "and shows no numbers");
  });
});

describe("access grants and the per-request check", () => {
  it("a pending partner can't be given access", async () => {
    assert.equal((await lookupPartnerCode(agency.code))!.status, "pending");
    await assert.rejects(grantPartnerAccess({ tenantId: shopA.id, code: agency.code, role: "manager", ownerUserId: owner.id }), (e: unknown) => e instanceof PartnerError && e.code === "INACTIVE");
  });
  it("once approved: grant → verify gives the role; one partner at a time", async () => {
    await setPartnerStatus(agency.id, "active", null, owner.id);
    await setPartnerStatus(rival.id, "active", null, owner.id);
    const g = await grantPartnerAccess({ tenantId: shopA.id, code: agency.code.toLowerCase(), role: "manager", ownerUserId: owner.id });
    assert.equal(g.changed, true);
    const v = await verifyPartnerAccess(agency.userId, agency.id, shopA.id);
    assert.equal(v?.role, "manager");
    assert.equal(v?.tenantSlug, shopA.slug);
    await assert.rejects(grantPartnerAccess({ tenantId: shopA.id, code: rival.code, role: "staff", ownerUserId: owner.id }), (e: unknown) => e instanceof PartnerError && e.code === "TAKEN");
    const again = await grantPartnerAccess({ tenantId: shopA.id, code: agency.code, role: "staff", ownerUserId: owner.id });
    assert.equal(again.changed, true, "role change");
    assert.equal((await verifyPartnerAccess(agency.userId, agency.id, shopA.id))?.role, "staff");
    const view = await getShopPartner(shopA.id);
    assert.equal(view.access?.name, "Bida Digital");
  });
  it("the check fails closed: wrong user, wrong shop, other partner", async () => {
    assert.equal(await verifyPartnerAccess(rival.userId, agency.id, shopA.id), null, "another user can't borrow the partner id");
    assert.equal(await verifyPartnerAccess(agency.userId, agency.id, shopB.id), null, "referral-only shop");
    assert.equal(await verifyPartnerAccess(rival.userId, rival.id, shopA.id), null);
  });
  it("revoke is immediate; re-grant works; suspend and a removed user block too", async () => {
    await revokePartnerAccess(shopA.id);
    assert.equal(await verifyPartnerAccess(agency.userId, agency.id, shopA.id), null);
    assert.equal((await getShopPartner(shopA.id)).access, null);
    await grantPartnerAccess({ tenantId: shopA.id, code: agency.code, role: "manager", ownerUserId: owner.id });
    assert.ok(await verifyPartnerAccess(agency.userId, agency.id, shopA.id));
    await setPartnerStatus(agency.id, "suspended", "Complaints", owner.id);
    assert.equal(await verifyPartnerAccess(agency.userId, agency.id, shopA.id), null);
    await setPartnerStatus(agency.id, "active", null, owner.id);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, agency.userId));
    assert.equal(await verifyPartnerAccess(agency.userId, agency.id, shopA.id), null);
    await db.update(users).set({ status: "active" }).where(eq(users.id, agency.userId));
    assert.ok(await verifyPartnerAccess(agency.userId, agency.id, shopA.id));
  });
  it("dashboard numbers only for shops with access; ops counts referrals", async () => {
    await createOrderForTenant({
      tenantSlug: shopA.slug,
      items: [{ productId: soapId, quantity: 2 }],
      customer: { name: "Buyer", phone: "09170004444" },
      deliveryType: "pickup",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
    });
    const a = (await listPartnerShops(agency.id)).find((s) => s.tenantId === shopA.id)!;
    assert.equal(a.role, "manager");
    assert.equal(a.stats?.orders30d, 1);
    assert.equal(a.stats?.sales30d, 200);
    const ops = await listPartnersForOps({ q: "bida" });
    const row = ops.find((r) => r.id === agency.id)!;
    assert.equal(row.referredShops, 1);
    assert.equal(row.referredPaid, 1, "shop B is on a paid plan");
    assert.equal(row.shopsWithAccess, 1);
  });
});

describe("platform v1.1: product writes and webhooks", () => {
  let created = "";
  it("create: simple product, draft by default, with SKU; emits product.created", async () => {
    await createWebhookEndpoint({ tenantId: shopA.id, url: "https://hooks.example.com/p", events: ["product.created", "product.updated"], secretSealed: "v1.sealed", createdByName: "Tess" });
    const p = await apiCreateProduct(shopA.id, { title: "Candle", price: 250, compare_at_price: 300, sku: `CDL-${run}`, stock: 7 });
    created = p.id;
    assert.equal(p.status, "draft");
    assert.equal(p.price, "250.00");
    assert.equal(p.variants[0]!.sku, `CDL-${run}`);
    assert.equal(p.variants[0]!.stock, 7);
    await assert.rejects(apiCreateProduct(shopA.id, { title: "Bad", price: 300, compare_at_price: 200 }), ApiInputError);
    const r = await fanOutWebhookEvents({ tenantId: shopA.id });
    assert.ok(r.events >= 1);
    const [ev] = await db.select().from(webhookEvents).where(and(eq(webhookEvents.tenantId, shopA.id), eq(webhookEvents.event, "product.created")));
    const payload = ev!.payloadJson as { data: { object: { id: string; title: string } } };
    assert.equal(payload.data.object.id, created);
    assert.equal(payload.data.object.title, "Candle");
  });
  it("update: price/status; product.updated only for meaningful changes", async () => {
    const before = (await db.select().from(webhookEvents).where(and(eq(webhookEvents.tenantId, shopA.id), eq(webhookEvents.event, "product.updated")))).length;
    const p = await apiUpdateProduct(shopA.id, created, { price: 199, compare_at_price: null, status: "active" });
    assert.equal(p!.price, "199.00");
    assert.equal(p!.compare_at_price, null);
    assert.equal(p!.status, "active");
    assert.equal(p!.variants[0]!.price, "199.00", "the single variant follows");
    const after = (await db.select().from(webhookEvents).where(and(eq(webhookEvents.tenantId, shopA.id), eq(webhookEvents.event, "product.updated")))).length;
    assert.equal(after, before + 1);
    assert.equal(await apiUpdateProduct(shopB.id, created, { title: "Nope" }), null, "other shop's product is not found");
    // Title- or status-only edits (no price) used to throw "No values to set".
    assert.equal((await apiUpdateProduct(shopA.id, created, { title: "Candle Jar" }))!.title, "Candle Jar");
    assert.equal((await apiUpdateProduct(shopA.id, created, { status: "draft" }))!.status, "draft");
  });
  it("variants: price per variant keeps 'from ₱X' right; SKU must be unique; options products refuse a product price", async () => {
    const view = await saveProductVariants(shopA.id, soapId, {
      options: [{ name: "Size", values: ["S", "L"] }],
      variants: [
        { options: { Size: "S" }, price: 100, stockQty: 5 },
        { options: { Size: "L" }, price: 150, stockQty: 5 },
      ],
    });
    const large = view.variants.find((v) => v.title === "L")!;
    const small = view.variants.find((v) => v.title === "S")!;
    await assert.rejects(apiUpdateProduct(shopA.id, soapId, { price: 50 }), ApiInputError);
    const v = await apiUpdateVariant(shopA.id, small.id, { price: 180, sku: `SOAP-S-${run}` });
    assert.equal(v!.price, "180.00");
    const soap = await apiGetProduct(shopA.id, soapId);
    assert.equal(soap!.price, "150.00", "the product shows the cheapest variant");
    await assert.rejects(apiUpdateVariant(shopA.id, large.id, { sku: `SOAP-S-${run}` }), /already used/);
    await assert.rejects(apiUpdateVariant(shopA.id, large.id, { compare_at_price: 100 }), ApiInputError);
    assert.equal(await apiUpdateVariant(shopB.id, large.id, { price: 1 }), null, "other shop's variant is not found");
  });
});
