/**
 * Integration test: the single order lifecycle service (Phase 1).
 *
 * Real database — the guarantees here (restock exactly once, refund exactly
 * once, row locks) only exist at the database level.
 *
 * Run (local docker-compose Postgres only — see orders-concurrency.test.ts):
 *   $env:DATABASE_URL="postgres://postgres:postgres@localhost:5434/gumakart"
 *   pnpm --filter @gumakart/db test:integration
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import {
  expireUnpaidOrders,
  refundOrder,
  applyOrderAction,
} from "./queries/order-lifecycle";
import {
  OrderError,
  createOrderForTenant,
  getOrderForTracking,
  markOrderPaidByIntent,
  recordPaymentIntent,
} from "./queries/orders";
import { confirmManualOrderPayment, submitManualPaymentReference } from "./queries/manual-payments";
import { reviewKycSession, submitKycSession, isTenantKycApproved } from "./queries/kyc";
import { getTenantSettings, updateTenantSettings } from "./queries/tenant-settings";
import { requestTenantPayout, WalletError } from "./queries/wallet";
import {
  customers,
  gatewayRefunds,
  kycDocuments,
  kycVerificationSessions,
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
  domainEvents,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive lifecycle tests against a hosted database.");
}
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Use DATABASE_URL=postgres://postgres:postgres@localhost:5434/gumakart"
  );
}

const db = getDb();
const slug = `test-lifecycle-${randomUUID().slice(0, 8)}`;
let tenantId = "";
let productId = "";
let variantId = "";
const START_STOCK = 10;

async function stock(): Promise<number> {
  const [v] = await db
    .select({ stockQty: productVariants.stockQty })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return v!.stockQty ?? 0;
}

function phone() {
  return `+639${Math.floor(100000000 + Math.random() * 899999999)}`;
}

function place(paymentMethod: "cod" | "gcash", quantity = 2) {
  return createOrderForTenant({
    tenantSlug: slug,
    items: [{ productId, quantity }],
    customer: { name: "Test Buyer", phone: phone() },
    deliveryType: "delivery",
    paymentMethod,
    deliveryFee: 0,
    minOrderAmount: 0,
  });
}

const cancel = (orderId: string, tid = tenantId) =>
  applyOrderAction({ orderId, tenantId: tid, action: { type: "cancel" }, source: "seller" });
const courier = (orderId: string, to: "booked" | "picked_up" | "out_for_delivery" | "delivered") =>
  applyOrderAction({ orderId, action: { type: "fulfillment_update", to }, source: "courier" });

async function orderRow(id: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  return o!;
}

describe("order lifecycle", () => {
  before(async () => {
    const [tenant] = await db.insert(tenants).values({ slug, name: "Lifecycle Test Shop" }).returning();
    tenantId = tenant!.id;
    const [product] = await db
      .insert(products)
      .values({
        tenantId,
        title: "Ensaymada",
        slug: "ensaymada",
        status: "active",
        basePrice: "50.00",
        trackInventory: true,
      })
      .returning();
    productId = product!.id;
    const [variant] = await db
      .insert(productVariants)
      .values({ productId, sku: `${slug}-v`, title: "Box", price: "50.00", stockQty: START_STOCK })
      .returning();
    variantId = variant!.id;
  });

  after(async () => {
    const orderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(walletLedgerEntries).where(eq(walletLedgerEntries.tenantId, tenantId));
    await db.delete(gatewayRefunds).where(eq(gatewayRefunds.tenantId, tenantId));
    await db.delete(tenantPayouts).where(eq(tenantPayouts.tenantId, tenantId));
    await db.delete(tenantWallets).where(eq(tenantWallets.tenantId, tenantId));
    await db.delete(paymentTransactions).where(eq(paymentTransactions.tenantId, tenantId));
    await db.delete(orderStatusHistory).where(sql`${orderStatusHistory.orderId} in ${orderIds}`);
    await db.delete(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(customers).where(eq(customers.tenantId, tenantId));
    await db.delete(kycDocuments).where(eq(kycDocuments.tenantId, tenantId));
    await db.delete(kycVerificationSessions).where(eq(kycVerificationSessions.tenantId, tenantId));
    await db.delete(productVariants).where(eq(productVariants.productId, productId));
    await db.delete(products).where(eq(products.tenantId, tenantId));
    await db.delete(domainEvents).where(eq(domainEvents.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it("seller cancel restocks exactly once, even when two cancels race", async () => {
    const before = await stock();
    const order = await place("cod", 3);
    assert.equal(await stock(), before - 3);

    const results = await Promise.allSettled([
      cancel(order.id),
      cancel(order.id),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 1, "second cancel must be rejected (cancelled → cancelled is invalid)");
    assert.equal(await stock(), before, "stock returns once, not twice");
    assert.ok((await orderRow(order.id)).stockRestoredAt);

    const moves = await db
      .select({ reason: stockMovements.reason, delta: stockMovements.delta })
      .from(stockMovements)
      .where(eq(stockMovements.orderId, order.id));
    assert.deepEqual(
      moves.map((m) => `${m.reason}:${m.delta}`).sort(),
      ["restock_cancel:3", "sale:-3"],
      "ledger has exactly one sale and one restock"
    );
  });

  it("a paid order cannot be cancelled by the seller — only refunded", async () => {
    const order = await place("gcash", 1);
    await confirmManualOrderPayment({ tenantId, orderId: order.id });
    await assert.rejects(cancel(order.id), (e: unknown) => e instanceof OrderError);
    // A refund must go through refundOrder() (gateway + NOWAIT lock), never a bare action.
    await assert.rejects(
      applyOrderAction({ orderId: order.id, tenantId, action: { type: "refund" }, source: "seller" }),
      (e: unknown) => e instanceof OrderError
    );
  });

  it("seller transitions are tenant-scoped", async () => {
    const order = await place("cod", 1);
    await assert.rejects(
      applyOrderAction({
        orderId: order.id,
        tenantId: randomUUID(),
        action: { type: "accept" },
        source: "seller",
      }),
      (e: unknown) => e instanceof OrderError && e.code === "ORDER_NOT_FOUND"
    );
  });

  it("courier updates only move forward and never cancel", async () => {
    const order = await place("cod", 1);
    const first = await courier(order.id, "out_for_delivery");
    assert.equal(first.changed, true);
    const replay = await courier(order.id, "out_for_delivery");
    assert.equal(replay.changed, false, "webhook replay is a no-op");
    const stale = await courier(order.id, "booked");
    assert.equal(stale.changed, false, "late 'booked' after 'out for delivery' is ignored");
    await assert.rejects(
      applyOrderAction({ orderId: order.id, action: { type: "cancel" }, source: "courier" })
    );
  });

  it("COD delivered marks the order paid and records the cash once", async () => {
    const order = await place("cod", 1);
    await courier(order.id, "out_for_delivery");
    await courier(order.id, "delivered");
    await courier(order.id, "delivered");

    const row = await orderRow(order.id);
    assert.equal(row.orderState, "completed");
    assert.equal(row.paymentState, "paid");
    assert.equal(row.fulfillmentState, "delivered");
    assert.equal(row.status, "delivered", "legacy column dual-written");
    assert.equal(row.paymentStatus, "paid");
    assert.ok(row.completedAt);
    const payments = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.gateway, "cod")));
    assert.equal(payments.length, 1);
    assert.equal(payments[0]!.status, "paid");
    const credits = await db
      .select()
      .from(walletLedgerEntries)
      .where(and(eq(walletLedgerEntries.orderId, order.id), eq(walletLedgerEntries.type, "sale_credit")));
    // Security G2 (GK-6): cash the seller collected at the door never enters the
    // platform wallet — only gateway money does.
    assert.equal(credits.length, 0, "COD cash is not a platform-held balance");
  });

  it("expiry cancels stale unpaid orders and restocks, but skips ones with a payment reference", async () => {
    const before = await stock();
    const stale = await place("gcash", 2);
    const referenced = await place("gcash", 1);
    const fresh = await place("gcash", 1);
    await submitManualPaymentReference({ tenantId, orderId: referenced.id, reference: "GC-12345" });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await db.update(orders).set({ createdAt: old }).where(sql`${orders.id} in (${stale.id}, ${referenced.id})`);

    const result = await expireUnpaidOrders({ olderThanHours: 24 });
    assert.ok(result.orderIds.includes(stale.id));
    assert.ok(!result.orderIds.includes(referenced.id), "buyer already sent a reference");
    assert.ok(!result.orderIds.includes(fresh.id), "not old enough");
    assert.equal((await orderRow(stale.id)).orderState, "cancelled");
    assert.equal((await orderRow(referenced.id)).paymentState, "pending_verification");
    assert.equal(await stock(), before - 2, "only the stale order's 2 units came back");

    const again = await expireUnpaidOrders({ olderThanHours: 24 });
    assert.ok(!again.orderIds.includes(stale.id), "idempotent");
  });

  it("a payment arriving after cancellation keeps the order closed and flags a refund", async () => {
    const order = await place("gcash", 1);
    const intentId = `pi_test_${randomUUID()}`;
    await recordPaymentIntent({
      orderId: order.id,
      tenantId,
      gatewayIntentId: intentId,
      amount: order.total,
      methodType: "gcash",
    });
    await cancel(order.id);

    const result = await markOrderPaidByIntent(intentId, "pay_test_late", {});
    assert.equal(result.ok, true);
    assert.equal(result.paidAfterCancel, true);
    const row = await orderRow(order.id);
    assert.equal(row.orderState, "cancelled", "late payment must not reopen the order");
    assert.equal(row.paymentState, "paid", "…but the money is recorded so Refund is offered");

    const manual = await place("gcash", 1);
    await cancel(manual.id);
    const confirm = await confirmManualOrderPayment({ tenantId, orderId: manual.id });
    assert.equal(confirm.ok, false, "seller can't confirm payment on a closed order");
  });

  it("refund happens exactly once and calls the gateway once", async () => {
    const before = await stock();
    const order = await place("gcash", 2);
    const intentId = `pi_test_${randomUUID()}`;
    await recordPaymentIntent({
      orderId: order.id,
      tenantId,
      gatewayIntentId: intentId,
      amount: order.total,
      methodType: "gcash",
    });
    await markOrderPaidByIntent(intentId, "pay_test_refund", {});
    // recordPaymentIntent writes gateway "paymongo"; confirm the row is paid.
    let gatewayCalls = 0;
    const refundAtGateway = async () => {
      gatewayCalls += 1;
      await new Promise((r) => setTimeout(r, 200)); // hold the lock while the 2nd click lands
      return { refundId: "ref_test_1" };
    };

    const results = await Promise.allSettled([
      refundOrder({ tenantId, orderId: order.id, refundAtGateway }),
      refundOrder({ tenantId, orderId: order.id, refundAtGateway }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 1, "only one refund succeeds");
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof OrderError);
    assert.equal(gatewayCalls, 1, "PayMongo refund called once");

    const row = await orderRow(order.id);
    assert.equal(row.orderState, "cancelled");
    assert.equal(row.paymentState, "refunded");
    assert.equal(row.status, "refunded", "legacy column dual-written");
    assert.equal(row.paymentStatus, "refunded");
    assert.equal(await stock(), before, "refund before shipping restocks");

    await assert.rejects(refundOrder({ tenantId, orderId: order.id, refundAtGateway }));
    assert.equal(gatewayCalls, 1);
  });

  it("manual-transfer refunds don't touch the gateway", async () => {
    const order = await place("gcash", 1);
    await submitManualPaymentReference({ tenantId, orderId: order.id, reference: "GC-99999" });
    await confirmManualOrderPayment({ tenantId, orderId: order.id });
    const result = await refundOrder({
      tenantId,
      orderId: order.id,
      refundAtGateway: async () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(result.refundedOutsidePlatform, true);
  });

  it("stock ledger reconciles with the variant's stock and records seller edits", async () => {
    const { updateProductForTenant } = await import("./queries/products");
    await updateProductForTenant(tenantId, productId, { stockQty: (await stock()) + 5 });
    const [{ total }] = await db
      .select({ total: sql<number>`coalesce(sum(${stockMovements.delta}), 0)::int` })
      .from(stockMovements)
      .where(eq(stockMovements.variantId, variantId));
    // The test variant was seeded directly (no "initial" row), so the ledger
    // explains everything that happened after START_STOCK.
    assert.equal(START_STOCK + total, await stock());
    const reasons = await db
      .selectDistinct({ reason: stockMovements.reason })
      .from(stockMovements)
      .where(eq(stockMovements.variantId, variantId));
    const seen = new Set(reasons.map((r) => r.reason));
    for (const r of ["sale", "restock_cancel", "restock_expiry", "restock_refund", "adjustment"]) {
      assert.ok(seen.has(r as never), `expected a ${r} movement`);
    }
  });

  it("order page needs the access token", async () => {
    const order = await place("cod", 1);
    assert.equal(order.accessToken.length, 64);
    assert.equal(await getOrderForTracking(slug, order.orderNumber, undefined), null);
    assert.equal(await getOrderForTracking(slug, order.orderNumber, "x".repeat(64)), null);
    const tampered = order.accessToken.slice(0, 63) + (order.accessToken.endsWith("0") ? "1" : "0");
    assert.equal(await getOrderForTracking(slug, order.orderNumber, tampered), null);
    const ok = await getOrderForTracking(slug, order.orderNumber, order.accessToken);
    assert.equal(ok?.orderNumber, order.orderNumber);
  });
});

after(async () => {
  await closeDb();
});

describe("KYC lock-down", () => {
  const kycSlug = `test-kyc-${randomUUID().slice(0, 8)}`;
  let kycTenant = "";

  before(async () => {
    const [t] = await getDb().insert(tenants).values({ slug: kycSlug, name: "KYC Test" }).returning();
    kycTenant = t!.id;
  });

  after(async () => {
    const d = getDb();
    await d.delete(kycDocuments).where(eq(kycDocuments.tenantId, kycTenant));
    await d.delete(kycVerificationSessions).where(eq(kycVerificationSessions.tenantId, kycTenant));
    await d.delete(tenantWallets).where(eq(tenantWallets.tenantId, kycTenant));
    await d.delete(tenants).where(eq(tenants.id, kycTenant));
  });

  it("a settings patch can't mark the shop verified", async () => {
    await updateTenantSettings(kycTenant, {
      settings: { wallet: { kycVerified: true, kycStatus: "approved", payoutMethod: "gcash" } },
    });
    const s = await getTenantSettings(kycTenant);
    assert.notEqual(s?.settings.wallet?.kycVerified, true);
    assert.equal(s?.settings.wallet?.payoutMethod, "gcash", "other wallet fields still save");
    assert.equal(await isTenantKycApproved(kycTenant), false);
  });

  it("submitting queues for review; only platform review approves", async () => {
    const d = getDb();
    const [session] = await d
      .insert(kycVerificationSessions)
      .values({
        tenantId: kycTenant,
        token: randomUUID(),
        status: "in_progress",
        idPath: "primary",
        primaryIdType: "passport",
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    for (const docType of ["primary_id", "selfie"] as const) {
      await d.insert(kycDocuments).values({
        sessionId: session!.id,
        tenantId: kycTenant,
        docType,
        mimeType: "image/jpeg",
        storageKey: `test/${docType}.jpg`,
      });
    }

    const submitted = await submitKycSession(kycTenant, session!.id);
    assert.equal(submitted.status, "submitted");
    assert.equal(await isTenantKycApproved(kycTenant), false);
    await assert.rejects(submitKycSession(kycTenant, session!.id), "can't submit twice");

    await assert.rejects(
      reviewKycSession({ tenantId: kycTenant, sessionId: session!.id, decision: "reject" }),
      "reject needs a reason"
    );
    const approved = await reviewKycSession({ tenantId: kycTenant, sessionId: session!.id, decision: "approve" });
    assert.equal(approved.status, "approved");
    assert.equal(await isTenantKycApproved(kycTenant), true);
    const s = await getTenantSettings(kycTenant);
    assert.equal(s?.settings.wallet?.kycVerified, true);
  });

  it("payouts stay off unless WALLET_PAYOUTS_ENABLED=true", async () => {
    const saved = process.env.WALLET_PAYOUTS_ENABLED;
    delete process.env.WALLET_PAYOUTS_ENABLED;
    try {
      await assert.rejects(
        requestTenantPayout({
          tenantId: kycTenant,
          amountCentavos: 10_000,
          method: "gcash",
          destinationAccount: "09171234567",
          destinationName: "Test",
        }),
        (e: unknown) => e instanceof WalletError && e.code === "PAYOUTS_DISABLED"
      );
    } finally {
      if (saved !== undefined) process.env.WALLET_PAYOUTS_ENABLED = saved;
    }
  });
});
