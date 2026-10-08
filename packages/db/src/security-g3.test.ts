/**
 * Security slice G3 (audit 2026-10-07: GK-20) — the hash-chained audit log.
 * Local Postgres only (the test database has `app.audit_bypass = on` so fixture
 * clean-up can delete rows; the refusal checks below switch it off per transaction):
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5434/gumakart npx tsx --test src/security-g3.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { logActivity } from "./queries/activity";
import { listAuditEvents, recordAuditEvent, runAuditChainCheck, verifyAuditChain, withCronLock } from "./queries/audit";
import { createOrderForTenant, markOrderPaidByIntent, recordPaymentIntent } from "./queries/orders";
import { activityLog, auditEvents, customers, orderItems, orderStatusHistory, orders, paymentTransactions, productVariants, products, stockMovements, tenants, domainEvents, walletLedgerEntries, tenantWallets } from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set.");

const db = getDb();
const slug = `test-g3-${randomUUID().slice(0, 8)}`;
let tenantId = "";
let productId = "";
let variantId = "";

/** Runs `fn` with the test bypass OFF, the way production connections always are. */
async function strict<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local app.audit_bypass = 'off'`);
    return fn(tx);
  });
}

describe("security G3", () => {
  before(async () => {
    const [tenant] = await db.insert(tenants).values({ slug, name: "G3 Shop" }).returning();
    tenantId = tenant!.id;
    const [product] = await db.insert(products).values({ tenantId, title: "Pandesal", slug: "pandesal", status: "active", basePrice: "10.00", trackInventory: true }).returning();
    productId = product!.id;
    const [variant] = await db.insert(productVariants).values({ productId, sku: `${slug}-v`, title: "Bag", price: "10.00", stockQty: 20 }).returning();
    variantId = variant!.id;
  });

  after(async () => {
    const orderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(walletLedgerEntries).where(eq(walletLedgerEntries.tenantId, tenantId));
    await db.delete(tenantWallets).where(eq(tenantWallets.tenantId, tenantId));
    await db.delete(paymentTransactions).where(eq(paymentTransactions.tenantId, tenantId));
    await db.delete(stockMovements).where(eq(stockMovements.tenantId, tenantId));
    await db.delete(orderStatusHistory).where(sql`${orderStatusHistory.orderId} in ${orderIds}`);
    await db.delete(orderItems).where(sql`${orderItems.orderId} in ${orderIds}`);
    await db.delete(domainEvents).where(eq(domainEvents.tenantId, tenantId));
    await db.delete(orders).where(eq(orders.tenantId, tenantId));
    await db.delete(customers).where(eq(customers.tenantId, tenantId));
    await db.delete(activityLog).where(eq(activityLog.tenantId, tenantId));
    await db.delete(productVariants).where(eq(productVariants.id, variantId));
    await db.delete(products).where(eq(products.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    // audit_events rows are never deleted — they have no FK and stay as the shop's history.
    await closeDb();
  });

  it("actions land in the chain inside their own transaction, and the chain verifies", async () => {
    await logActivity(tenantId, { userId: null, name: "Tester", role: "owner" }, { action: "test.something", summary: "did a thing" });
    const order = await createOrderForTenant({ tenantSlug: slug, items: [{ productId, quantity: 1 }], customer: { name: "Buyer", phone: `+639${Math.floor(100000000 + Math.random() * 899999999)}` }, deliveryType: "delivery", paymentMethod: "gcash", deliveryFee: 0, minOrderAmount: 0 });
    const intentId = `pi_${randomUUID().slice(0, 10)}`;
    await recordPaymentIntent({ orderId: order.id, tenantId, gatewayIntentId: intentId, amount: order.total, methodType: "gcash" });
    await markOrderPaidByIntent(intentId, "pay_g3", undefined, { amountCentavos: Math.round(Number(order.total) * 100), currency: "PHP" });
    await db.update(productVariants).set({ price: "12.00" }).where(eq(productVariants.id, variantId));
    await recordAuditEvent({ tenantId, actorLabel: "seller@example.com", action: "auth.login", entityType: "user", entityId: randomUUID(), details: { ip: "127.0.0.1" } });

    const events = await listAuditEvents({ tenantId, limit: 100 });
    const actions = events.map((e) => e.action);
    for (const expected of ["test.something", "order.changed", "payment_transactions.status", "wallet.sale_credit", "variant.price", "auth.login"]) {
      assert.ok(actions.includes(expected), `chain has ${expected} (got ${actions.join(", ")})`);
    }
    const v = await verifyAuditChain(tenantId);
    assert.equal(v.ok, true);
    assert.ok(v.checked >= 6);
    // Every row links to the previous one.
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId)).orderBy(auditEvents.seq);
    for (let i = 1; i < rows.length; i++) assert.equal(rows[i]!.prevHash, rows[i - 1]!.hash);
    assert.equal(rows[0]!.prevHash, "0".repeat(64));
  });

  it("logs and ledgers refuse edits and deletes; ledger entries may only change status; paid money is frozen", async () => {
    const [act] = await db.select().from(activityLog).where(eq(activityLog.tenantId, tenantId)).limit(1);
    await assert.rejects(strict((tx) => tx.update(activityLog).set({ summary: "nothing happened" }).where(eq(activityLog.id, act!.id))), /append-only/);
    await assert.rejects(strict((tx) => tx.delete(activityLog).where(eq(activityLog.id, act!.id))), /append-only/);
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.tenantId, tenantId)).limit(1);
    await assert.rejects(strict((tx) => tx.delete(stockMovements).where(eq(stockMovements.id, mv!.id))), /append-only/);
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId)).limit(1);
    await assert.rejects(strict((tx) => tx.update(auditEvents).set({ details: {} }).where(eq(auditEvents.seq, ev!.seq))), /append-only/);
    // The audit chain ignores the test bypass entirely.
    await assert.rejects(db.delete(auditEvents).where(eq(auditEvents.seq, ev!.seq)), /append-only/);

    const [led] = await db.select().from(walletLedgerEntries).where(eq(walletLedgerEntries.tenantId, tenantId)).limit(1);
    await assert.rejects(strict((tx) => tx.update(walletLedgerEntries).set({ netAmount: "999.00" }).where(eq(walletLedgerEntries.id, led!.id))), /only the status/);
    await strict((tx) => tx.update(walletLedgerEntries).set({ status: "available" }).where(eq(walletLedgerEntries.id, led!.id)));

    const [pay] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.tenantId, tenantId)).limit(1);
    assert.equal(pay!.status, "paid");
    await assert.rejects(strict((tx) => tx.update(paymentTransactions).set({ amount: "1.00" }).where(eq(paymentTransactions.id, pay!.id))), /frozen/);
    await assert.rejects(strict((tx) => tx.update(paymentTransactions).set({ status: "pending" }).where(eq(paymentTransactions.id, pay!.id))), /only move to refunded/);
    await assert.rejects(strict((tx) => tx.delete(paymentTransactions).where(eq(paymentTransactions.id, pay!.id))), /never deleted/);
  });

  it("a superuser edit with the trigger off is still detected; a consistently re-hashed tail is caught by the recorded head", async () => {
    const good = await runAuditChainCheck();
    assert.equal(good.find((r) => r.tenantId === tenantId)?.ok, true);
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId)).orderBy(auditEvents.seq).limit(1);
    await db.execute(sql`alter table audit_events disable trigger trg_audit_events_immutable`);
    try {
      await db.update(auditEvents).set({ details: { forged: true } }).where(eq(auditEvents.seq, row!.seq));
      const v = await verifyAuditChain(tenantId);
      assert.equal(v.ok, false);
      assert.equal(v.problem, "row contents do not match its hash");
      // restore
      await db.execute(sql`update audit_events set details = ${JSON.stringify(row!.details)}::jsonb where seq = ${row!.seq}`);
      assert.equal((await verifyAuditChain(tenantId)).ok, true);
      // Rewrite the last row AND re-hash it consistently: verify alone passes, the daily check doesn't.
      const [last] = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId)).orderBy(sql`seq desc`).limit(1);
      await db.execute(sql`update audit_events set details = details || '{"forged":true}'::jsonb where seq = ${last!.seq}`);
      await db.execute(sql`update audit_events a set hash = encode(sha256(convert_to(a.prev_hash||'|'||a.id::text||'|'||coalesce(a.tenant_id::text,'')||'|'||coalesce(a.actor_id::text,'')||'|'||coalesce(a.actor_label,'')||'|'||a.action||'|'||a.entity_type||'|'||coalesce(a.entity_id,'')||'|'||a.details::text||'|'||a.created_at::text,'utf8')),'hex') where seq = ${last!.seq}`);
      assert.equal((await verifyAuditChain(tenantId)).ok, true, "a consistent re-hash fools the walk alone");
      const check = await runAuditChainCheck();
      const mine = check.find((r) => r.tenantId === tenantId)!;
      assert.equal(mine.ok, false);
      assert.match(mine.problem ?? "", /rewritten since the previous check/);
    } finally {
      await db.execute(sql`alter table audit_events enable trigger trg_audit_events_immutable`);
    }
  });

  it("a cron lock is held by one run at a time and released afterwards", async () => {
    const name = `test-${slug}`;
    let inside = 0;
    const slow = () => withCronLock(name, async () => { inside += 1; await new Promise((r) => setTimeout(r, 150)); return "ran"; });
    const results = await Promise.all([slow(), slow(), slow()]);
    assert.equal(results.filter((r) => r === "ran").length, 1);
    assert.equal(results.filter((r) => r === null).length, 2);
    assert.equal(inside, 1);
    assert.equal(await withCronLock(name, async () => "again"), "again", "released after the run");
  });
});
