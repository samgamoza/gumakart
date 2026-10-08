/**
 * Security slice G2 (audit 2026-10-07: GK-6, GK-13, GK-14, GK-16, GK-17, GK-18).
 * Local Postgres only:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5434/gumakart npx tsx --test src/security-g2.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { applyOrderAction, refundOrder, settleGatewayRefund } from "./queries/order-lifecycle";
import { createOrderForTenant, markOrderPaidByIntent, recordPaymentIntent } from "./queries/orders";
import { recordReturn } from "./queries/after-sale";
import { getWalletSummary, reconcileWallets, releaseOrderSaleCredit } from "./queries/wallet";
import {
  customers,
  gatewayRefunds,
  orderItems,
  orderReturns,
  orderStatusHistory,
  orders,
  paymentTransactions,
  productVariants,
  products,
  stockMovements,
  tenantPayouts,
  tenantWallets,
  tenants,
  walletLedgerEntries,
  walletReconciliations,
  domainEvents,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set.");

const db = getDb();
const slug = `test-g2-${randomUUID().slice(0, 8)}`;
let tenantId = "";
let productId = "";
let variantId = "";
const phone = () => `+639${Math.floor(100000000 + Math.random() * 899999999)}`;

function place(paymentMethod: "cod" | "gcash", quantity = 2, customer?: { name: string; phone: string; email?: string }) {
  return createOrderForTenant({
    tenantSlug: slug,
    items: [{ productId, quantity }],
    customer: customer ?? { name: "Test Buyer", phone: phone() },
    deliveryType: "delivery",
    paymentMethod,
    deliveryFee: 0,
    minOrderAmount: 0,
  });
}

/** Places a gcash order and settles it through the gateway webhook path. */
async function paidOnline(quantity = 2) {
  const order = await place("gcash", quantity);
  const intentId = `pi_${randomUUID().slice(0, 12)}`;
  await recordPaymentIntent({ orderId: order.id, tenantId, gatewayIntentId: intentId, amount: order.total, methodType: "gcash" });
  const r = await markOrderPaidByIntent(intentId, `pay_${randomUUID().slice(0, 8)}`, undefined, { amountCentavos: Math.round(Number(order.total) * 100), currency: "PHP" });
  assert.equal(r.transitioned, true);
  return { order, intentId };
}
const stock = async () => (await db.select({ q: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId)))[0]!.q ?? 0;

describe("security G2", () => {
  before(async () => {
    const [tenant] = await db.insert(tenants).values({ slug, name: "G2 Shop" }).returning();
    tenantId = tenant!.id;
    const [product] = await db.insert(products).values({ tenantId, title: "Ensaymada", slug: "ensaymada", status: "active", basePrice: "100.00", trackInventory: true }).returning();
    productId = product!.id;
    const [variant] = await db.insert(productVariants).values({ productId, sku: `${slug}-v`, title: "Box", price: "100.00", stockQty: 50 }).returning();
    variantId = variant!.id;
  });

  after(async () => {
    const orderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(walletReconciliations).where(eq(walletReconciliations.tenantId, tenantId));
    await db.delete(walletLedgerEntries).where(eq(walletLedgerEntries.tenantId, tenantId));
    await db.delete(gatewayRefunds).where(eq(gatewayRefunds.tenantId, tenantId));
    await db.delete(tenantPayouts).where(eq(tenantPayouts.tenantId, tenantId));
    await db.delete(tenantWallets).where(eq(tenantWallets.tenantId, tenantId));
    await db.delete(orderReturns).where(eq(orderReturns.tenantId, tenantId));
    await db.delete(paymentTransactions).where(eq(paymentTransactions.tenantId, tenantId));
    await db.delete(stockMovements).where(eq(stockMovements.tenantId, tenantId));
    await db.delete(orderStatusHistory).where(sql`${orderStatusHistory.orderId} in ${orderIds}`);
    await db.delete(orderItems).where(sql`${orderItems.orderId} in ${orderIds}`);
    await db.delete(domainEvents).where(eq(domainEvents.tenantId, tenantId));
    await db.delete(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(customers).where(eq(customers.tenantId, tenantId));
    await db.delete(productVariants).where(eq(productVariants.id, variantId));
    await db.delete(products).where(eq(products.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeDb();
  });

  // GK-6 -----------------------------------------------------------------------
  it("only gateway money is credited; COD is not", async () => {
    const { order } = await paidOnline();
    const credits = await db.select().from(walletLedgerEntries).where(and(eq(walletLedgerEntries.orderId, order.id), eq(walletLedgerEntries.type, "sale_credit")));
    assert.equal(credits.length, 1);
    assert.equal(credits[0]!.status, "pending");
    const cod = await place("cod", 1);
    await applyOrderAction({ orderId: cod.id, tenantId, action: { type: "fulfillment_update", to: "delivered" }, source: "courier" });
    const codCredits = await db.select().from(walletLedgerEntries).where(eq(walletLedgerEntries.orderId, cod.id));
    assert.equal(codCredits.length, 0, "cash in hand never becomes a platform balance");
  });

  it("a pending credit is released exactly once under parallel runs", async () => {
    const { order } = await paidOnline();
    const results = await Promise.all([releaseOrderSaleCredit(order.id), releaseOrderSaleCredit(order.id), releaseOrderSaleCredit(order.id)]);
    assert.equal(results.filter(Boolean).length, 1);
    const [entry] = await db.select().from(walletLedgerEntries).where(and(eq(walletLedgerEntries.orderId, order.id), eq(walletLedgerEntries.type, "sale_credit")));
    assert.equal(entry!.status, "available");
  });

  it("a partial refund debits the wallet; a refund bigger than the balance becomes money owed, never ₱0", async () => {
    const { order } = await paidOnline(2); // ₱200 subtotal
    await releaseOrderSaleCredit(order.id);
    const before = await getWalletSummary(tenantId);
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await applyOrderAction({ orderId: order.id, tenantId, action: { type: "fulfillment_update", to: "delivered" }, source: "courier" });
    // Return one of two boxes, ₱100 back by cash: the wallet gives back its share.
    const ret = await recordReturn(tenantId, order.id, { items: [{ orderItemId: line!.id, qty: 1, restock: true }], refundAmount: 100, refundMethod: "cash" }, { userId: null as unknown as string, name: "Seller" });
    assert.equal(ret.refunded, 100);
    const debits = await db.select().from(walletLedgerEntries).where(and(eq(walletLedgerEntries.orderId, order.id), eq(walletLedgerEntries.type, "refund_debit")));
    assert.equal(debits.length, 1);
    assert.equal(Number(debits[0]!.netAmount), -100);
    const after1 = await getWalletSummary(tenantId);
    assert.equal(Math.round((Number(before.availableBalance) - Number(after1.availableBalance)) * 100), 10000);

    // Drain the wallet to zero with a (ledgered) adjustment, then refund the rest: the shortfall is owed.
    const drained = await getWalletSummary(tenantId);
    await db.insert(walletLedgerEntries).values({ tenantId, type: "adjustment", status: "completed", grossAmount: drained.availableBalance, feeAmount: "0.00", netAmount: (-Number(drained.availableBalance)).toFixed(2), description: "test drain", reference: `adj:${randomUUID()}` });
    await db.update(tenantWallets).set({ availableBalance: "0.00" }).where(eq(tenantWallets.tenantId, tenantId));
    await recordReturn(tenantId, order.id, { items: [], refundAmount: 100, refundMethod: "cash" }, { userId: null as unknown as string, name: "Seller" });
    const after2 = await getWalletSummary(tenantId);
    assert.equal(Number(after2.availableBalance), 0);
    assert.ok(Number(after2.owedBalance) > 0, `owed ${after2.owedBalance}`);
    // The next release pays the debt down first.
    const { order: next } = await paidOnline(2);
    await releaseOrderSaleCredit(next.id);
    const after3 = await getWalletSummary(tenantId);
    assert.ok(Number(after3.owedBalance) < Number(after2.owedBalance));
  });

  it("the nightly reconciliation finds a balance that disagrees with the ledger", async () => {
    const clean = await reconcileWallets(tenantId);
    assert.equal(clean.mismatched, 0, "fresh wallet reconciles");
    await db.update(tenantWallets).set({ availableBalance: sql`${tenantWallets.availableBalance} + 7` }).where(eq(tenantWallets.tenantId, tenantId));
    const dirty = await reconcileWallets(tenantId);
    assert.equal(dirty.mismatched, 1);
    await db.update(tenantWallets).set({ availableBalance: sql`${tenantWallets.availableBalance} - 7` }).where(eq(tenantWallets.tenantId, tenantId));
  });

  // GK-13 ----------------------------------------------------------------------
  it("a full refund records the gateway refund once and sends it after commit; a failed send is retried, never doubled", async () => {
    const { order } = await paidOnline(1);
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("gateway down");
      return { refundId: `ref_${calls}` };
    };
    const first = await refundOrder({ tenantId, orderId: order.id, refundAtGateway: flaky });
    assert.ok(first.gatewayRefundPending, "recorded, not sent");
    const row = await db.select().from(orders).where(eq(orders.id, order.id));
    assert.equal(row[0]!.paymentState, "refunded", "the order is refunded even though the gateway call failed");
    const pending = await db.select().from(gatewayRefunds).where(eq(gatewayRefunds.orderId, order.id));
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.status, "failed");
    // A second refund attempt cannot create a second gateway refund.
    await assert.rejects(refundOrder({ tenantId, orderId: order.id, refundAtGateway: flaky }));
    // Retry sends it exactly once, even when retried in parallel.
    const [a, b] = await Promise.all([settleGatewayRefund(pending[0]!.id, flaky), settleGatewayRefund(pending[0]!.id, flaky)]);
    assert.equal([a, b].filter((r) => r.ok).length >= 1, true);
    assert.equal(calls, 2, "the gateway was asked to refund exactly once after the failure");
    const done = await db.select().from(gatewayRefunds).where(eq(gatewayRefunds.orderId, order.id));
    assert.equal(done[0]!.status, "sent");
    assert.equal(done[0]!.gatewayRefundId, "ref_2");
  });

  // GK-14 ----------------------------------------------------------------------
  it("cancelling restocks what was taken, not what was ordered", async () => {
    const s0 = await stock();
    const order = await place("cod", 3);
    assert.equal(await stock(), s0 - 3);
    // One unit already came back (a short pickup / early return recorded against the order).
    await db.update(productVariants).set({ stockQty: sql`${productVariants.stockQty} + 1` }).where(eq(productVariants.id, variantId));
    await db.insert(stockMovements).values({ tenantId, variantId, orderId: order.id, reason: "return_restock", delta: 1, balanceAfter: s0 - 2 });
    assert.equal(await stock(), s0 - 2);
    await applyOrderAction({ orderId: order.id, tenantId, action: { type: "cancel" }, source: "seller" });
    assert.equal(await stock(), s0, "exactly the two units still out came back — not three");
  });

  // GK-16 ----------------------------------------------------------------------
  it("a second payment on a paid order is flagged, and a wrong amount is never confirmed", async () => {
    const order = await place("gcash", 1);
    const intentA = `pi_${randomUUID().slice(0, 10)}`;
    const intentB = `pi_${randomUUID().slice(0, 10)}`;
    await recordPaymentIntent({ orderId: order.id, tenantId, gatewayIntentId: intentA, amount: order.total, methodType: "gcash" });
    const wrong = await markOrderPaidByIntent(intentA, "pay_wrong", undefined, { amountCentavos: 1, currency: "PHP" });
    assert.equal(wrong.amountMismatch, true);
    assert.equal((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.paymentState, "unpaid");
    await db.update(paymentTransactions).set({ status: "pending" }).where(eq(paymentTransactions.gatewayIntentId, intentA));
    const ok = await markOrderPaidByIntent(intentA, "pay_a", undefined, { amountCentavos: Math.round(Number(order.total) * 100), currency: "PHP" });
    assert.equal(ok.transitioned, true);
    await db.insert(paymentTransactions).values({ orderId: order.id, tenantId, gateway: "paymongo", gatewayIntentId: intentB, amount: order.total, status: "pending", methodType: "gcash" });
    const dup = await markOrderPaidByIntent(intentB, "pay_b", undefined, { amountCentavos: Math.round(Number(order.total) * 100), currency: "PHP" });
    assert.equal(dup.duplicate, true);
    const [rowB] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.gatewayIntentId, intentB));
    assert.equal(rowB!.status, "failed");
    assert.match(rowB!.failureReason ?? "", /duplicate/);
  });

  // GK-18 ----------------------------------------------------------------------
  it("a guest checkout matched by phone fills blanks but never rewrites a known customer", async () => {
    const p = phone();
    await place("cod", 1, { name: "Maria Santos", phone: p, email: "maria@example.com" });
    await place("cod", 1, { name: "Someone Else", phone: p, email: "attacker@example.com" });
    const [c] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phone, p)));
    assert.equal(c!.name, "Maria Santos");
    assert.equal(c!.email, "maria@example.com");
  });
});
