/**
 * AI Marketing Suite Phase 1 (migration 0047): tier entitlements, credit metering, media job
 * lifecycle, dispatcher queries, CRM segments (local Postgres only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { AI_SUITE_TIERS } from "@gumakart/plans";
import postgres from "postgres";
import { closeDb, getDb } from "./client";
import {
  claimAiMediaJob,
  completeAiMediaJob,
  enqueueAiMediaJob,
  failAiMediaJob,
  getMerchantEntitlements,
  listDispatchableAiMediaJobs,
  listStaleDispatchedAiMediaJobs,
  markAiMediaJobsDispatched,
  resetAiMediaJobDispatch,
} from "./queries/ai-media-jobs";
import { createOrderForTenant } from "./queries/orders";
import {
  aiMediaJobs,
  buyerCrmSegments,
  merchantEntitlements,
  productVariants,
  products,
  socialAccounts,
  socialAutomationRules,
  socialThreads,
  subscriptionTiers,
  tenants,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) {
  throw new Error("Refusing to run destructive tests against a hosted database.");
}
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const created: string[] = [];

async function shop(plan: string | null): Promise<string> {
  const [row] = await db
    .insert(tenants)
    .values({ slug: `test-ai-${run}-${created.length}`, name: `AI shop ${created.length}`, status: "active", subscriptionPlan: plan })
    .returning({ id: tenants.id });
  created.push(row!.id);
  return row!.id;
}

async function ent(tenantId: string) {
  const [row] = await db.select().from(merchantEntitlements).where(eq(merchantEntitlements.tenantId, tenantId));
  return row!;
}

const photo = (tenantId: string, key?: string) =>
  enqueueAiMediaJob({ tenantId, jobType: "product_photo", inputPayload: { scene: "studio" }, idempotencyKey: key ?? null });

after(async () => {
  try {
    await db.delete(aiMediaJobs).where(inArray(aiMediaJobs.tenantId, created));
    await db.delete(merchantEntitlements).where(inArray(merchantEntitlements.tenantId, created));
  } catch {
    // best effort — leftovers are namespaced by run id
  }
  await closeDb();
});

describe("entitlements follow tenants.subscription_plan (trigger)", () => {
  it("new shops get a row; legacy ids are grandfathered; new tiers get their quotas", async () => {
    const t = await shop(null);
    let e = await ent(t);
    assert.equal(e.tierId, "free");
    assert.equal(e.photoCreditsLimit, 0);

    await db.update(tenants).set({ subscriptionPlan: "growth" }).where(eq(tenants.id, t));
    e = await ent(t);
    assert.deepEqual([e.tierId, e.isGrandfathered, e.photoCreditsLimit, e.videoCreditsLimit], ["growth", true, 20, 0]);

    await db.update(tenants).set({ subscriptionPlan: "advance" }).where(eq(tenants.id, t));
    e = await ent(t);
    assert.deepEqual([e.tierId, e.isGrandfathered], ["pro", true], "advance alias → legacy pro (Advance)");

    await db.update(tenants).set({ subscriptionPlan: "pro_live" }).where(eq(tenants.id, t));
    e = await ent(t);
    assert.deepEqual(
      [e.tierId, e.isGrandfathered, e.photoCreditsLimit, e.videoCreditsLimit, e.aiCloserEnabled, e.queuePriority],
      ["pro_live", false, 100, 10, true, 2]
    );

    await db.update(tenants).set({ subscriptionPlan: "enterprise_vibe" }).where(eq(tenants.id, t));
    e = await ent(t);
    assert.deepEqual([e.photoCreditsLimit, e.videoCreditsLimit, e.voiceCloneEnabled, e.queuePriority], [-1, 40, true, 1]);
  });

  it("admin overrides survive plan changes; usage survives upgrades", async () => {
    const t = await shop("starter");
    await photo(t);
    await db.update(merchantEntitlements).set({ limitsOverridden: true, photoCreditsLimit: 500 }).where(eq(merchantEntitlements.tenantId, t));
    await db.update(tenants).set({ subscriptionPlan: "pro_live" }).where(eq(tenants.id, t));
    const e = await ent(t);
    assert.equal(e.tierId, "pro_live");
    assert.equal(e.photoCreditsLimit, 500, "override kept");
    assert.equal(e.photoCreditsUsed, 1, "usage kept across the upgrade");
  });

  it("editing a tier re-applies its limits to shops on it", async () => {
    const t = await shop("starter");
    try {
      await db.update(subscriptionTiers).set({ photoCreditsLimit: 25 }).where(eq(subscriptionTiers.id, "starter"));
      assert.equal((await ent(t)).photoCreditsLimit, 25);
    } finally {
      await db.update(subscriptionTiers).set({ photoCreditsLimit: AI_SUITE_TIERS.starter.photoCreditsLimit }).where(eq(subscriptionTiers.id, "starter"));
    }
    assert.equal((await ent(t)).photoCreditsLimit, 20);
  });
});

describe("credit metering", () => {
  it("Free can't render photos; Starter gets exactly 20 a month", async () => {
    const free = await shop("free");
    assert.deepEqual(await photo(free), { ok: false, reason: "photo_not_included" });

    const t = await shop("starter");
    for (let i = 0; i < 20; i += 1) assert.equal((await photo(t)).ok, true, `photo ${i + 1}`);
    assert.deepEqual(await photo(t), { ok: false, reason: "out_of_credits" });
    const summary = await getMerchantEntitlements(t);
    assert.equal(summary!.photoCreditsRemaining, 0);
  });

  it("concurrent submits never overspend", async () => {
    const t = await shop("starter");
    await db.update(merchantEntitlements).set({ limitsOverridden: true, photoCreditsLimit: 5 }).where(eq(merchantEntitlements.tenantId, t));
    const results = await Promise.all(Array.from({ length: 12 }, () => photo(t)));
    assert.equal(results.filter((r) => r.ok).length, 5);
    assert.equal((await ent(t)).photoCreditsUsed, 5);
  });

  it("idempotency key: same request twice = one job, one credit", async () => {
    const t = await shop("starter");
    const a = await photo(t, "upload-123");
    const b = await photo(t, "upload-123");
    assert.ok(a.ok && b.ok);
    assert.equal(a.job.id, b.job.id);
    assert.equal(b.duplicate, true);
    assert.equal((await ent(t)).photoCreditsUsed, 1);
    const [race1, race2] = await Promise.all([photo(t, "race"), photo(t, "race")]);
    assert.ok(race1.ok && race2.ok && race1.job.id === race2.job.id);
    assert.equal((await ent(t)).photoCreditsUsed, 2, "racing duplicate rolled its credit back");
  });

  it("failed job refunds exactly once; completed job consumes", async () => {
    const t = await shop("starter");
    const a = await photo(t);
    const b = await photo(t);
    assert.ok(a.ok && b.ok);
    assert.equal((await ent(t)).photoCreditsUsed, 2);

    assert.deepEqual(await failAiMediaJob(a.job.id, "comfy exploded"), { failed: true, refunded: true });
    assert.deepEqual(await failAiMediaJob(a.job.id, "again"), { failed: false, refunded: false });
    assert.equal((await ent(t)).photoCreditsUsed, 1);

    assert.ok(await claimAiMediaJob(b.job.id, "gpu-test"));
    assert.equal(await completeAiMediaJob(b.job.id, [{ url: "https://x/y.png", kind: "image", contentType: "image/png" }]), true);
    assert.equal(await completeAiMediaJob(b.job.id, []), false, "second completion is a no-op");
    assert.deepEqual(await failAiMediaJob(b.job.id, "late"), { failed: false, refunded: false }, "can't fail a completed job");
    assert.equal(await claimAiMediaJob(b.job.id, "gpu-test"), null, "redelivery after completion is skipped");
    const [row] = await db.select().from(aiMediaJobs).where(eq(aiMediaJobs.id, b.job.id));
    assert.equal(row!.creditStatus, "consumed");
    assert.equal(row!.outputUrls.length, 1);
    assert.equal((await ent(t)).photoCreditsUsed, 1);
  });

  it("month rollover resets usage; a late refund doesn't leak into the new month", async () => {
    const t = await shop("starter");
    const old = await photo(t);
    assert.ok(old.ok);
    await db
      .update(merchantEntitlements)
      .set({ periodStart: "2026-01-01", photoCreditsUsed: 20 })
      .where(eq(merchantEntitlements.tenantId, t));
    await db.update(aiMediaJobs).set({ creditPeriod: "2026-01-01" }).where(eq(aiMediaJobs.id, old.job.id));
    const summary = await getMerchantEntitlements(t);
    assert.equal(summary!.photoCreditsRemaining, 20, "stale period reads as fresh");

    assert.equal((await photo(t)).ok, true);
    let e = await ent(t);
    assert.notEqual(e.periodStart, "2026-01-01");
    assert.equal(e.photoCreditsUsed, 1);

    assert.deepEqual(await failAiMediaJob(old.job.id, "late failure"), { failed: true, refunded: false });
    e = await ent(t);
    assert.equal(e.photoCreditsUsed, 1);
  });

  it("video, voice clone and printair gating + priorities", async () => {
    const starter = await shop("starter");
    assert.deepEqual(await enqueueAiMediaJob({ tenantId: starter, jobType: "video_ad", inputPayload: {} }), { ok: false, reason: "video_not_included" });

    const live = await shop("pro_live");
    const v = await enqueueAiMediaJob({ tenantId: live, jobType: "video_ad", inputPayload: {} });
    assert.ok(v.ok);
    assert.deepEqual([v.job.priority, v.job.creditKind, v.job.creditStatus], [2, "video", "reserved"]);
    assert.deepEqual(await enqueueAiMediaJob({ tenantId: live, jobType: "voice_clone", inputPayload: {} }), { ok: false, reason: "voice_clone_not_included" });

    const vibe = await shop("enterprise_vibe");
    const vc = await enqueueAiMediaJob({ tenantId: vibe, jobType: "voice_clone", inputPayload: {} });
    assert.ok(vc.ok);
    assert.deepEqual([vc.job.priority, vc.job.creditStatus], [1, "none"]);
    for (let i = 0; i < 3; i += 1) assert.ok((await photo(vibe)).ok, "unlimited photos");

    const free = await shop("free");
    const m = await enqueueAiMediaJob({ tenantId: free, jobType: "printair_mockup", inputPayload: {} });
    assert.ok(m.ok);
    assert.deepEqual([m.job.priority, m.job.creditStatus], [10, "none"]);
  });
});

describe("dispatcher queries", () => {
  it("dispatch order = tier priority then age; stale dispatches can be reset", async () => {
    await db.update(aiMediaJobs).set({ dispatchedAt: sql`now()` }).where(sql`${aiMediaJobs.dispatchedAt} is null`);
    const starter = await shop("starter");
    const vibe = await shop("enterprise_vibe");
    const s1 = await photo(starter);
    const v1 = await photo(vibe);
    assert.ok(s1.ok && v1.ok);

    const list = await listDispatchableAiMediaJobs(10);
    assert.deepEqual(list.map((j) => j.id), [v1.job.id, s1.job.id], "Enterprise Vibe first even though it was submitted later");

    await markAiMediaJobsDispatched([v1.job.id, s1.job.id]);
    assert.equal((await listDispatchableAiMediaJobs(10)).length, 0);

    await db.update(aiMediaJobs).set({ dispatchedAt: sql`now() - interval '2 hours'` }).where(eq(aiMediaJobs.id, s1.job.id));
    const stale = await listStaleDispatchedAiMediaJobs(60 * 60 * 1000);
    assert.ok(stale.includes(s1.job.id) && !stale.includes(v1.job.id));
    await resetAiMediaJobDispatch([s1.job.id]);
    assert.deepEqual((await listDispatchableAiMediaJobs(10)).map((j) => j.id), [s1.job.id]);
  });

  it("status changes NOTIFY ai_media_jobs for live dashboards", async () => {
    const t = await shop("starter");
    const got: Array<{ id: string; status: string; tenantId: string }> = [];
    const listenSql = postgres(url, { max: 1 });
    const listener = await listenSql.listen("ai_media_jobs", (payload) => got.push(JSON.parse(payload)));
    const j = await photo(t);
    assert.ok(j.ok);
    await claimAiMediaJob(j.job.id, "gpu-test");
    await completeAiMediaJob(j.job.id, []);
    for (let i = 0; i < 50 && got.filter((g) => g.id === j.job.id).length < 3; i += 1) await new Promise((r) => setTimeout(r, 20));
    await listener.unlisten();
    await listenSql.end();
    assert.deepEqual(got.filter((g) => g.id === j.job.id).map((g) => g.status), ["queued", "processing", "completed"]);
    assert.equal(got.find((g) => g.id === j.job.id)!.tenantId, t);
  });
});

describe("social + CRM tables", () => {
  it("automation rule defaults and thread conversion state", async () => {
    const t = await shop("pro_live");
    const [acct] = await db
      .insert(socialAccounts)
      .values({ tenantId: t, platform: "messenger", externalId: `page-${run}`, name: "Page", phoneNumberId: "pn-1", wabaId: "waba-1" })
      .returning();
    const [rule] = await db.insert(socialAutomationRules).values({ tenantId: t, triggerKeywords: sql`DEFAULT`, publicReplyTemplates: sql`DEFAULT` }).returning();
    assert.deepEqual(rule!.triggerKeywords, ["HM", "MINE", "Available pa?", "Details", "Magkano"]);
    assert.equal(rule!.publicReplyTemplates.length, 3);
    await assert.rejects(
      db.insert(socialAutomationRules).values({ tenantId: t, triggerKeywords: ["hm"], publicReplyTemplates: ["x"] }),
      /duplicate key/,
      "one global rule per shop"
    );

    const [thread] = await db
      .insert(socialThreads)
      .values({ tenantId: t, accountId: acct!.id, platform: "messenger", externalUserId: `psid-${run}` })
      .returning();
    assert.equal(thread!.conversionStatus, "open");
    assert.equal(thread!.aiPaused, false);
    await assert.rejects(
      db.update(socialThreads).set({ conversionStatus: "bogus" as never }).where(eq(socialThreads.id, thread!.id)),
      /social_threads_conversion_status_chk/
    );
  });

  it("refresh_buyer_crm_segments tags VIP, payday and inactive buyers", async () => {
    const t = await shop("pro_live");
    const [{ slug }] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, t));
    const [p] = await db.insert(products).values({ tenantId: t, title: "Tee", slug: `tee-${run}`, status: "active", basePrice: "250.00", trackInventory: false }).returning();
    await db.insert(productVariants).values({ productId: p!.id, title: "Default", price: "250.00", stockQty: 100, sku: `TEE-${run}` });

    const place = async (phone: string, isoDate: string) => {
      const res = await createOrderForTenant({
        tenantSlug: slug,
        items: [{ productId: p!.id, quantity: 1 }],
        customer: { name: "Buyer", phone },
        deliveryType: "pickup",
        paymentMethod: "cod",
        deliveryFee: 0,
        minOrderAmount: 0,
      });
      const orderId = res.id;
      await getDb().execute(sql`update orders set created_at = ${isoDate}::timestamptz where id = ${orderId}::uuid and tenant_id = ${t}::uuid`);
    };
    const recent = (day: number) => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 1, day);
      d.setUTCHours(4, 0, 0, 0); // noon in Manila
      return d.toISOString();
    };
    // VIP + payday: 3 orders, all on 15th/30th
    await place("09171110001", recent(15));
    await place("09171110001", recent(28));
    await place("09171110001", recent(14));
    // one-off, off-payday, 90+ days ago → inactive
    await place("09172220002", new Date(Date.now() - 95 * 86_400_000).toISOString().slice(0, 10) + "T04:00:00Z");

    const rows = (await getDb().execute(sql`select refresh_buyer_crm_segments(${t}::uuid) as n`)) as unknown as Array<{ n: number }>;
    assert.equal(Number(rows[0]!.n), 2);
    const segs = await db.select().from(buyerCrmSegments).where(eq(buyerCrmSegments.tenantId, t));
    const vip = segs.find((s) => s.buyerKey === "phone:9171110001")!;
    assert.deepEqual([vip.totalOrders, vip.paydayOrders, Number(vip.totalSpent)], [3, 3, 750]);
    assert.ok(vip.tags.includes("VIP_REPEAT") && vip.tags.includes("PAYDAY_SHOPPER") && !vip.tags.includes("INACTIVE_60D"));
    const lapsed = segs.find((s) => s.buyerKey === "phone:9172220002")!;
    assert.ok(lapsed.tags.includes("INACTIVE_60D") && !lapsed.tags.includes("VIP_REPEAT"));
  });
});
