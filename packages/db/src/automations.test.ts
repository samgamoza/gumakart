/**
 * Phase 4 — automatic SMS data rules (local Postgres only).
 *   - unfinished checkout: consent + phone + 30 min (step 1) / 24 h (step 2), not if they ordered
 *   - a step can only be claimed once (overlapping cron runs)
 *   - link carts point back to the live link; closed links get no text
 *   - unpaid reminder: e-wallet only, consent only, once
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  claimRecoveryStep,
  describeRecoveryCart,
  getAutomationSummary,
  getOrderMessagingContext,
  listRecoveryCandidates,
  listUnpaidReminderCandidates,
} from "./queries/automations";
import { createCheckoutLink, updateCheckoutLink } from "./queries/checkout-links";
import { sendWithLog } from "./queries/message-log";
import { createOrderForTenant } from "./queries/orders";
import {
  checkoutLinks,
  checkoutSessions,
  customers,
  domainEvents,
  locations,
  messageLog,
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
const shop = { id: "", slug: `test-auto-${run}` };
let mugId = "";
let linkCode = "";
let linkId = "";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function session(key: string, values: Partial<typeof checkoutSessions.$inferInsert>) {
  const [row] = await db
    .insert(checkoutSessions)
    .values({
      tenantId: shop.id,
      sessionKey: `${key}-${run}`,
      cartJson: { linkCode },
      phone: "09171110000",
      marketingConsent: true,
      sourceChannel: "checkout_link",
      ...values,
    })
    .returning();
  return row!;
}

async function candidateIds(): Promise<Map<string, 1 | 2>> {
  const list = await listRecoveryCandidates({ limit: 500 });
  return new Map(list.filter((c) => c.tenantId === shop.id).map((c) => [c.sessionId, c.step]));
}

before(async () => {
  const [t] = await db
    .insert(tenants)
    .values({ slug: shop.slug, name: "Auto Shop", status: "active", settingsJson: { payments: { receiving: { gcashNumber: "09171234567" } } } as never })
    .returning();
  shop.id = t!.id;
  const [p] = await db
    .insert(products)
    .values({ tenantId: shop.id, title: "Mug", slug: `mug-${run}`, status: "active", basePrice: "349.00" })
    .returning();
  mugId = p!.id;
  await db.insert(productVariants).values({ productId: mugId, title: "Mug", price: "349.00", stockQty: 50 });
  const link = await createCheckoutLink(shop.id, null, { items: [{ productId: mugId, quantity: 1 }] });
  linkCode = link.code;
  linkId = link.id;
});

after(async () => {
  const shopOrders = db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, shop.id));
  await db.delete(messageLog).where(eq(messageLog.tenantId, shop.id));
  await db.delete(checkoutSessions).where(eq(checkoutSessions.tenantId, shop.id));
  await db.delete(domainEvents).where(eq(domainEvents.tenantId, shop.id));
  await db.delete(stockMovements).where(eq(stockMovements.tenantId, shop.id));
  await db.delete(paymentTransactions).where(eq(paymentTransactions.tenantId, shop.id));
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders));
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders));
  await db.delete(orders).where(eq(orders.tenantId, shop.id));
  await db.delete(customers).where(eq(customers.tenantId, shop.id));
  await db.delete(locations).where(eq(locations.tenantId, shop.id));
  await db.delete(checkoutLinks).where(eq(checkoutLinks.tenantId, shop.id));
  const prods = db.select({ id: products.id }).from(products).where(eq(products.tenantId, shop.id));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods));
  await db.delete(products).where(eq(products.tenantId, shop.id));
  await db.delete(tenants).where(eq(tenants.id, shop.id));
  await closeDb();
});

describe("unfinished checkout candidates", () => {
  it("picks consented, idle sessions at the right step and skips the rest", async () => {
    const due1 = await session("due1", { lastActivityAt: minutesAgo(40), phone: "09171110001" });
    const noConsent = await session("noconsent", { lastActivityAt: minutesAgo(40), marketingConsent: false, phone: "09171110002" });
    const fresh = await session("fresh", { lastActivityAt: minutesAgo(10), phone: "09171110003" });
    const due2 = await session("due2", { lastActivityAt: minutesAgo(25 * 60), phone: "09171110004" });
    const tooOld = await session("old", { lastActivityAt: minutesAgo(80 * 60), phone: "09171110005" });
    const noPhone = await session("nophone", { lastActivityAt: minutesAgo(40), phone: null });

    // Ordered afterwards from the same number (written differently): no text.
    const ordered = await session("ordered", { lastActivityAt: minutesAgo(40), phone: "0917 111 0006", createdAt: minutesAgo(60) });
    await createOrderForTenant({
      tenantSlug: shop.slug,
      items: [{ productId: mugId, quantity: 1 }],
      customer: { name: "Bought", phone: "+639171110006" },
      deliveryType: "pickup",
      paymentMethod: "cod",
      deliveryFee: 0,
      minOrderAmount: 0,
    });

    const found = await candidateIds();
    assert.equal(found.get(due1.id), 1);
    assert.equal(found.get(due2.id), 2);
    for (const s of [noConsent, fresh, tooOld, noPhone, ordered]) assert.equal(found.has(s.id), false, s.sessionKey);
  });

  it("a step is claimed once; after step 1 the session waits for 24 h", async () => {
    const s = await session("claim", { lastActivityAt: minutesAgo(45), phone: "09171110007" });
    assert.equal(await claimRecoveryStep(s.id, 1), true);
    assert.equal(await claimRecoveryStep(s.id, 1), false);
    assert.equal((await candidateIds()).has(s.id), false);
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, s.id));
    assert.equal(row!.status, "abandoned");
    assert.equal(row!.recoverySentCount, 1);
  });

  it("link carts go back to the live link with the product name; closed links get nothing", async () => {
    assert.deepEqual(await describeRecoveryCart(shop.id, shop.slug, { linkCode }), { path: `/c/${linkCode}`, productTitle: "Mug" });
    assert.deepEqual(await describeRecoveryCart(shop.id, shop.slug, [{ productId: mugId, qty: 1 }]), { path: `/${shop.slug}`, productTitle: "Mug" });
    await updateCheckoutLink(shop.id, linkId, { active: false });
    assert.equal(await describeRecoveryCart(shop.id, shop.slug, { linkCode }), null);
    await updateCheckoutLink(shop.id, linkId, { active: true });
    assert.equal(await describeRecoveryCart(shop.id, shop.slug, { linkCode: "zzzzzzz" }), null);
  });
});

describe("unpaid reminder candidates", () => {
  async function order(paymentMethod: "gcash" | "cod", phone: string, consent: boolean) {
    return createOrderForTenant({
      tenantSlug: shop.slug,
      items: [{ productId: mugId, quantity: 1 }],
      customer: { name: "Buyer", phone },
      deliveryType: "pickup",
      paymentMethod,
      deliveryFee: 0,
      minOrderAmount: 0,
      smsMarketingConsent: consent,
    });
  }

  it("e-wallet + consent + 6 h unpaid → once", async () => {
    const yes = await order("gcash", "09172220001", true);
    const noConsent = await order("gcash", "09172220002", false);
    const cod = await order("cod", "09172220003", true);
    const later = new Date(Date.now() + 7 * 3_600_000);

    const ids = async (now: Date) =>
      new Set((await listUnpaidReminderCandidates({ now, limit: 500 })).map((c) => c.orderId));

    assert.equal((await ids(new Date())).has(yes.id), false, "not before 6 h");
    const due = await ids(later);
    assert.equal(due.has(yes.id), true);
    assert.equal(due.has(noConsent.id), false);
    assert.equal(due.has(cod.id), false);

    const ctx = await getOrderMessagingContext(yes.id);
    assert.equal(ctx?.paymentState, "unpaid");
    assert.equal(ctx?.tenantName, "Auto Shop");

    const sent = await sendWithLog(
      {
        tenantId: shop.id,
        orderId: yes.id,
        channel: "sms",
        recipient: "09172220001",
        recipe: "unpaid_reminder",
        step: 1,
        entityId: yes.id,
        body: "Auto Shop: Paalala Stop reminders: https://x/stop/abc.def",
        kind: "marketing",
      },
      async () => ({ success: true, messageId: "t1" })
    );
    assert.equal(sent.status, "sent");
    assert.equal((await ids(later)).has(yes.id), false, "only once");

    const summary = await getAutomationSummary(shop.id);
    assert.equal(summary.byRecipe.unpaid_reminder, 1);
    assert.equal(summary.sent30d >= 1, true);
  });
});
