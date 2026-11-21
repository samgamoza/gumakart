/**
 * AI suite Phases 4 + 5 end-to-end through the admin glue (mock sends, NODE_ENV=test):
 * paced broadcasts (session + WhatsApp template), the BayanGo review loop in chat, Printair
 * milestone → mockup job → card → signed handoff. Needs DATABASE_URL (local Postgres).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("DATABASE_URL is not set (use the local Postgres).");
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(dbUrl)) throw new Error("Refusing to run against a hosted database.");
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.GUMA_ECOSYSTEM_JWT_SECRET = "integration-ecosystem-secret-0123456789";
delete process.env.GPU_BRIDGE_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

let lib: typeof import("./ai-suite-growth");
let db: typeof import("@gumakart/db");
let services: typeof import("@gumakart/services");
let orm: typeof import("drizzle-orm");
const run = randomUUID().slice(0, 8);
const digits = run.replace(/\D/g, "").padEnd(3, "5").slice(0, 3);
const phone = (n: number) => `0917${digits}${String(n).padStart(4, "0")}`;
const ids = { tenant: "", slug: `test-p45i-${run}`, product: "", messenger: "", whatsapp: "" };

async function order(p: string, name: string, at = new Date()) {
  const o = await db.createOrderForTenant({ tenantSlug: ids.slug, items: [{ productId: ids.product, quantity: 1 }], customer: { name, phone: p }, deliveryType: "pickup", paymentMethod: "cod", deliveryFee: 0, minOrderAmount: 0 });
  await db.getDb().execute(orm.sql`update orders set created_at = ${at.toISOString()}::timestamptz where id = ${o.id}`);
  return o.id;
}

before(async () => {
  db = await import("@gumakart/db");
  services = await import("@gumakart/services");
  orm = await import("drizzle-orm");
  lib = await import("./ai-suite-growth");
  const d = db.getDb();
  const [t] = await d.insert(db.tenants).values({ slug: ids.slug, name: "P45 Integration", status: "active", subscriptionPlan: "pro_live" }).returning();
  const [p] = await d.insert(db.products).values({ tenantId: t!.id, title: "Ube Jam", slug: `jam-${run}`, status: "active", basePrice: "180.00", trackInventory: false }).returning();
  await d.insert(db.productVariants).values({ productId: p!.id, title: "Default", price: "180.00", stockQty: 0, sku: `P45I-${run}` });
  const m = await db.upsertSocialAccount({ tenantId: t!.id, platform: "messenger", externalId: `pgi-${run}`, name: "Page", pageId: `pgi-${run}`, accessTokenSealed: null, status: "mock" });
  const w = await db.upsertSocialAccount({ tenantId: t!.id, platform: "whatsapp", externalId: `wai-${run}`, name: "WA", pageId: null, accessTokenSealed: null, status: "mock" });
  Object.assign(ids, { tenant: t!.id, product: p!.id, messenger: m.id, whatsapp: w.id });
});

after(async () => {
  await db?.closeDb();
});

describe("Phase 4 broadcasts (paced, Meta-compliant)", () => {
  it("session messages to in-window chats, template to opted-in WhatsApp buyers outside it, ≤ 10 msg/s", async () => {
    const d = db.getDb();
    const { eq, sql } = orm;
    // Three payday shoppers: two chat on WhatsApp (one inside 24 h, one 3 days ago), one never chatted.
    for (const n of [1, 2, 3]) await order(phone(n), `Buyer ${n} Cruz`, new Date(Date.UTC(2026, 9, 15, 4)));
    await db.refreshBuyerSegments(ids.tenant);
    const wa = async (n: number, at: Date) => {
      const r = await db.recordSocialMessage({ account: { id: ids.whatsapp, tenantId: ids.tenant, platform: "whatsapp" }, userId: `63${phone(n).slice(-10)}`, messageId: `w-${randomUUID()}`, text: "hi", kind: "text", at });
      await d.update(db.socialThreads).set({ lastInboundAt: at }).where(eq(db.socialThreads.id, r.threadId));
      return r.threadId;
    };
    const fresh = await wa(1, new Date());
    const stale = await wa(2, new Date(Date.now() - 72 * 3_600_000));

    const b = await db.createBroadcast(ids.tenant, { name: "Payday", channel: "whatsapp", kind: "payday", segmentTags: ["PAYDAY_SHOPPER"], messageTemplate: "Hi {name}! Payday na! Gusto mo ulit ng {item}? {link}", waTemplateName: "payday_reorder", waTemplateLanguage: "en" }, "Owner");
    const q = await db.queueBroadcast(ids.tenant, b.id, null);
    assert.deepEqual([q.recipients, q.skipped], [3, 1], "buyer 3 never wrote and didn't opt in");

    const waits: number[] = [];
    const r = await lib.runBroadcasts({ now: new Date(Date.now() + 1000), sleepFn: async (ms) => void waits.push(ms) });
    assert.ok(r.sent >= 2, JSON.stringify(r));
    assert.ok(waits.length >= 1 && waits.every((w) => w <= 100), `paced at 10/s: ${waits.join(",")}`);
    const done = await db.getBroadcast(ids.tenant, b.id);
    assert.deepEqual([done!.status, done!.sent, done!.skipped], ["sent", 2, 1]);

    const freshMsgs = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, fresh));
    const sent = freshMsgs.find((m) => m.sentByName === "Guma broadcast")!;
    assert.match(sent.body, new RegExp(`^Hi Buyer! Payday na! Gusto mo ulit ng Ube Jam\\? .*/${ids.slug}/reorder/[0-9a-f-]{36}\\?ref=whatsapp`));
    assert.equal(sent.status, "mock");
    const staleMsgs = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, stale));
    assert.match(staleMsgs.find((m) => m.sentByName === "Guma broadcast")!.body, /^\[WhatsApp template "payday_reorder"\] Buyer/);
    const rec = (await d.execute(sql`select mode, status from broadcast_recipients where campaign_id = ${b.id} order by mode`)) as unknown as Array<{ mode: string; status: string }>;
    assert.deepEqual(rec.map((x) => `${x.mode}:${x.status}`).sort(), ["none:skipped", "session:sent", "template:sent"]);
  });

  it("a shop that lost the plan stops sending", async () => {
    const d = db.getDb();
    const b = await db.createBroadcast(ids.tenant, { name: "Later", channel: "whatsapp", kind: "custom", segmentTags: [], messageTemplate: "Hi {name} {link}", waTemplateName: "promo" }, "Owner");
    await db.queueBroadcast(ids.tenant, b.id, null);
    await d.update(db.tenants).set({ subscriptionPlan: "starter" }).where(orm.eq(db.tenants.id, ids.tenant));
    const r = await lib.runBroadcasts({ now: new Date(Date.now() + 1000), sleepFn: async () => undefined });
    assert.equal(r.sent, 0);
    assert.ok(r.skipped >= 1);
    await d.update(db.tenants).set({ subscriptionPlan: "pro_live" }).where(orm.eq(db.tenants.id, ids.tenant));
  });
});

describe("Phase 4 BayanGo review loop", () => {
  it("asks 2 h after delivery in the buyer's chat; '5 sarap!' publishes the review and replies with the voucher", async () => {
    const d = db.getDb();
    const { eq } = orm;
    const oid = await order(phone(7), "Gina Santos", new Date(Date.now() - 4 * 3_600_000));
    await d.execute(orm.sql`update orders set fulfillment_state = 'delivered' where id = ${oid}`);
    const t = await db.recordSocialMessage({ account: { id: ids.whatsapp, tenantId: ids.tenant, platform: "whatsapp" }, userId: `63${phone(7).slice(-10)}`, messageId: `w-${randomUUID()}`, text: "thanks", kind: "text", at: new Date() });
    await db.scheduleReviewPrompt({ orderId: oid, tenantId: ids.tenant, deliveredAt: new Date(Date.now() - 2.2 * 3_600_000) });
    const loop = await lib.runReviewLoop();
    assert.ok(loop.sent >= 1, JSON.stringify(loop));
    const msgs = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, t.threadId));
    assert.match(msgs.find((m) => m.sentByName === "Guma AI review")!.body, /^Hi Gina! Na-deliver na po ang Ube Jam from P45 Integration/);

    assert.equal(await lib.handleReviewReply({ tenantId: ids.tenant, threadId: t.threadId, accountId: ids.whatsapp, platform: "whatsapp", recipientId: `63${phone(7).slice(-10)}`, text: "nasan na po yung isa ko pang order?" }), false, "not a rating → the closer handles it");
    assert.equal(await lib.handleReviewReply({ tenantId: ids.tenant, threadId: t.threadId, accountId: ids.whatsapp, platform: "whatsapp", recipientId: `63${phone(7).slice(-10)}`, text: "5 sobrang sarap!" }), true);
    const [prompt] = await d.select().from(db.reviewPrompts).where(eq(db.reviewPrompts.orderId, oid));
    assert.deepEqual([prompt!.status, prompt!.rating, prompt!.body], ["reviewed", 5, "sobrang sarap!"]);
    const [review] = await d.select().from(db.productReviews).where(eq(db.productReviews.orderId, oid));
    assert.equal(review!.status, "published");
    const after = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, t.threadId));
    const thanks = after.filter((m) => m.sentByName === "Guma AI review").at(-1)!;
    assert.match(thanks.body, /thank-you voucher mo: \*[A-Z0-9-]+\* — ₱50 off/);
    assert.equal(await lib.handleReviewReply({ tenantId: ids.tenant, threadId: t.threadId, accountId: ids.whatsapp, platform: "whatsapp", recipientId: "x", text: "4" }), false, "prompt answered — back to normal chat");
  });

  it("Messenger outside 24 h: skipped (Meta rule), never sent", async () => {
    const d = db.getDb();
    const oid = await order(phone(8), "Hana", new Date(Date.now() - 4 * 3_600_000));
    const [cust] = await d.select().from(db.customers).where(orm.sql`${db.customers.tenantId} = ${ids.tenant} and ${db.customers.phone} like ${"%" + phone(8).slice(-7)}`);
    const t = await db.recordSocialMessage({ account: { id: ids.messenger, tenantId: ids.tenant, platform: "messenger" }, userId: `psid-${run}`, messageId: `m-${randomUUID()}`, text: "hi", kind: "text", at: new Date(Date.now() - 50 * 3_600_000) });
    await d.update(db.socialThreads).set({ customerId: cust!.id, lastInboundAt: new Date(Date.now() - 50 * 3_600_000) }).where(orm.eq(db.socialThreads.id, t.threadId));
    await db.scheduleReviewPrompt({ orderId: oid, tenantId: ids.tenant, deliveredAt: new Date(Date.now() - 3 * 3_600_000) });
    await lib.runReviewLoop();
    const [prompt] = await d.select().from(db.reviewPrompts).where(orm.eq(db.reviewPrompts.orderId, oid));
    assert.deepEqual([prompt!.status, prompt!.skipReason], ["skipped", "outside_24h"]);
  });
});

describe("Phase 5 Printair", () => {
  it("milestone → background mockup job → card → signed 5-minute handoff Printair can verify", async () => {
    const d = db.getDb();
    await d.execute(orm.sql`update orders set order_state = 'completed' where tenant_id = ${ids.tenant}`);
    const n = ((await d.execute(orm.sql`select count(*)::int as n from orders where tenant_id = ${ids.tenant}`)) as unknown as Array<{ n: number }>)[0]!.n;
    for (let i = n; i < 10; i++) {
      const id = await order(phone(30 + i), `B${i}`);
      await d.execute(orm.sql`update orders set order_state = 'completed' where id = ${id}`);
    }
    await lib.runPrintairUpsells({ limit: 5000 });
    const [up] = await d.select().from(db.printairUpsells).where(orm.eq(db.printairUpsells.tenantId, ids.tenant));
    assert.deepEqual([up!.milestone, up!.status], ["orders_10", "rendering"]);
    const [job] = await d.select().from(db.aiMediaJobs).where(orm.eq(db.aiMediaJobs.id, up!.aiMediaJobId!));
    assert.deepEqual([job!.jobType, job!.priority, job!.creditStatus], ["printair_mockup", 10, "none"]);
    assert.equal((job!.inputPayload as { storeUrl: string }).storeUrl.endsWith(`/${ids.slug}`), true);
    await d
      .update(db.aiMediaJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        outputUrls: [
          { url: "https://media.guma.one/m1.png", kind: "image", contentType: "image/png", variant: "mockup:thank_you_card" },
          { url: "https://media.guma.one/p.pdf", kind: "other", contentType: "application/pdf", variant: "print_pdf" },
        ],
      })
      .where(orm.eq(db.aiMediaJobs.id, job!.id));
    await lib.runPrintairUpsells({ limit: 5000 });
    const card = await db.getActivePrintairCard(ids.tenant);
    assert.ok(card);
    const h = await lib.buildPrintairHandoff(ids.tenant, card, { email: "owner@example.com", name: "Owner" });
    assert.ok(h.ok);
    const url = new URL(h.url);
    assert.equal(url.origin + url.pathname, "https://printair.guma.one/api/import-from-gumakart");
    const claims = await services.verifyEcosystemJwt(url.searchParams.get("token")!, process.env.GUMA_ECOSYSTEM_JWT_SECRET!, { aud: "printair", iss: "gumakart" });
    assert.equal(claims.merchant_id, ids.tenant);
    assert.equal(claims.print_ready_pdf_url, "https://media.guma.one/p.pdf");
    assert.deepEqual(claims.mockups, [{ url: "https://media.guma.one/m1.png", variant: "mockup:thank_you_card" }]);
    assert.ok(claims.exp - claims.iat <= 300);
  });
});
