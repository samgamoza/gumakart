/** Phase 16 — cron history, error capture, alert sync, status page, plan lifecycle, receipts (local Postgres only). */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { listCronJobStatus, listAppErrors, recordAppError, recordCronRuns, syncOpsAlerts, listOpsAlerts } from "./queries/operations";
import { addIncidentUpdate, createIncident, getPublicStatus, StatusPageError } from "./queries/status-page";
import { getBillingOverview, getPlanReceipt, runPlanLifecycle } from "./queries/billing";
import { createPlanPayment, markPlanPaymentPaidByIntent } from "./queries/plan-billing";
import { activityLog, appErrors, billingNotices, cronRuns, opsAlerts, planPayments, statusIncidents, tenants, users } from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres on :5434).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const job = `/api/cron/test-${run}`;
const shop = { id: "", slug: `test-ops-${run}` };
const DAY = 86_400_000;

before(async () => {
  const [t] = await db.insert(tenants).values({ slug: shop.slug, name: "Ops Shop", status: "active", subscriptionPlan: "growth", planExpiresAt: new Date(Date.now() + 2 * DAY) }).returning();
  shop.id = t!.id;
  await db.insert(users).values({ email: `owner-${run}@example.com`, role: "seller_owner", tenantId: shop.id });
});

after(async () => {
  await db.delete(cronRuns).where(eq(cronRuns.job, job));
  await db.delete(appErrors).where(like(appErrors.route, `%${run}%`));
  await db.delete(opsAlerts).where(like(opsAlerts.key, `test_${run}%`));
  await db.delete(statusIncidents).where(like(statusIncidents.title, `%${run}%`));
  await db.delete(activityLog).where(eq(activityLog.tenantId, shop.id));
  await db.delete(planPayments).where(eq(planPayments.tenantId, shop.id));
  await db.delete(users).where(eq(users.tenantId, shop.id));
  await db.delete(tenants).where(inArray(tenants.id, [shop.id]));
  await closeDb();
});

describe("cron runs", () => {
  it("records runs and summarises per job", async () => {
    const t0 = Date.now() - 3 * 60_000;
    await recordCronRuns([
      { job, startedAt: new Date(t0), durationMs: 120, ok: true, summary: "sent=2" },
      { job, startedAt: new Date(t0 + 60_000), durationMs: 80, ok: false, statusCode: 500, summary: "boom" },
    ]);
    const s = (await listCronJobStatus()).find((j) => j.job === job)!;
    assert.equal(s.runs24h, 2);
    assert.equal(s.failures24h, 1);
    assert.equal(s.lastOk, false);
    assert.equal(s.lastSuccessAt?.getTime(), t0);
    assert.equal(s.avgMs24h, 100);
  });
});

describe("app errors", () => {
  it("groups by route + normalised message, counts, dedupes one Error, reopens", async () => {
    const route = `GET /api/test-${run}`;
    const e1 = new Error("Order 11111111-2222-3333-4444-555555555555 not found");
    await recordAppError({ app: "admin", route, error: e1 });
    await recordAppError({ app: "admin", route, error: e1 });
    await recordAppError({ app: "admin", route, error: new Error("Order 99999999-2222-3333-4444-555555555555 not found") });
    const rows = (await listAppErrors({ limit: 200 })).filter((r) => r.route === route);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.count, 2, "same Error object counted once");
  });
});

describe("ops alerts", () => {
  it("opens, keeps and resolves by key", async () => {
    const k1 = `test_${run}_a`;
    const k2 = `test_${run}_b`;
    const first = await syncOpsAlerts([
      { key: k1, severity: "warning", title: "A" },
      { key: k2, severity: "critical", title: "B" },
    ]);
    assert.deepEqual(first.opened.map((a) => a.key).sort(), [k1, k2]);
    const second = await syncOpsAlerts([{ key: k1, severity: "warning", title: "A still" }]);
    assert.equal(second.opened.length, 0);
    assert.ok(second.resolved.some((a) => a.key === k2));
    const { open } = await listOpsAlerts();
    assert.equal(open.find((a) => a.key === k1)?.title, "A still");
    await syncOpsAlerts([]);
    assert.equal((await listOpsAlerts()).open.filter((a) => a.key.startsWith(`test_${run}`)).length, 0);
  });
});

describe("status page", () => {
  it("incidents drive component states and history", async () => {
    await assert.rejects(createIncident({ title: "x", impact: "minor", components: [], message: "m", createdBy: "t" }), StatusPageError);
    const id = await createIncident({ title: `SMS delayed ${run}`, impact: "minor", components: ["notifications"], message: "Some texts are late.", createdBy: "ops@test" });
    let s = await getPublicStatus();
    assert.equal(s.components.find((c) => c.id === "notifications")?.state, "partial_outage");
    assert.ok(s.active.some((i) => i.id === id));
    await addIncidentUpdate(id, { status: "resolved", message: "All caught up." });
    s = await getPublicStatus();
    assert.ok(s.history.some((i) => i.id === id && i.updates.length === 2));
    assert.ok(!s.active.some((i) => i.id === id));
  });
});

describe("plan lifecycle and receipts", () => {
  it("reminds once per period, grace, then downgrades", async () => {
    const now = new Date();
    let r = await runPlanLifecycle(now);
    const mine = r.notices.filter((n) => n.tenantId === shop.id);
    assert.equal(mine[0]?.kind, "reminder_3");
    assert.equal(mine[0]?.ownerEmail, `owner-${run}@example.com`);
    r = await runPlanLifecycle(now);
    assert.equal(r.notices.filter((n) => n.tenantId === shop.id).length, 0, "once per period");

    const ended = new Date(now.getTime() - 2 * DAY);
    await db.update(tenants).set({ planExpiresAt: ended }).where(eq(tenants.id, shop.id));
    r = await runPlanLifecycle(now);
    assert.equal(r.notices.find((n) => n.tenantId === shop.id)?.kind, "expired");
    assert.equal((await getBillingOverview(shop.id, now)).status.state, "grace");

    r = await runPlanLifecycle(new Date(ended.getTime() + 8 * DAY));
    assert.equal(r.notices.find((n) => n.tenantId === shop.id)?.kind, "downgraded");
    const [t] = await db.select().from(tenants).where(eq(tenants.id, shop.id));
    assert.equal(t!.subscriptionPlan, "free");
    assert.equal(t!.planExpiresAt, null);
    const notices = await db.select().from(billingNotices).where(eq(billingNotices.tenantId, shop.id));
    assert.equal(notices.length, 3);
  });

  it("a renewal that lands before the downgrade run is never undone", async () => {
    const ended = new Date(Date.now() - 9 * DAY);
    await db.update(tenants).set({ subscriptionPlan: "pro", planExpiresAt: ended }).where(eq(tenants.id, shop.id));
    // Payment arrives: extends from now (the old period already ended).
    await createPlanPayment({ tenantId: shop.id, plan: "pro", amount: "999.00", gatewayIntentId: `pi_${run}` });
    const paid = await markPlanPaymentPaidByIntent(`pi_${run}`);
    assert.equal(paid.transitioned, true);
    await runPlanLifecycle(new Date());
    const [t] = await db.select().from(tenants).where(eq(tenants.id, shop.id));
    assert.equal(t!.subscriptionPlan, "pro");
    assert.ok(t!.planExpiresAt! > new Date(Date.now() + 29 * DAY));

    const overview = await getBillingOverview(shop.id);
    const payment = overview.payments[0]!;
    assert.match(payment.receiptNumber ?? "", /^GK-\d{4}-\d{6}$/);
    const receipt = await getPlanReceipt(shop.id, payment.id);
    assert.equal(receipt?.shopName, "Ops Shop");
    assert.equal(await getPlanReceipt(randomUUID(), payment.id), null, "other shops can't open it");
    assert.equal((await markPlanPaymentPaidByIntent(`pi_${run}`)).transitioned, false, "webhook replay");
    const [p] = await db.select().from(planPayments).where(eq(planPayments.id, payment.id));
    assert.equal(p!.receiptNumber, payment.receiptNumber, "number never changes");
  });
});
