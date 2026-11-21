/** AI Marketing Suite Phase 3 (migration 0049): comment-to-DM, the AI closer's tools, cart recovery. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { getCheckoutLinkByCode } from "./queries/checkout-links";
import { createOrderForTenant } from "./queries/orders";
import { recordSocialMessage, upsertSocialAccount } from "./queries/social-inbox";
import {
  alreadyMessagedCommenter,
  availableChatPaymentMethods,
  claimCartNudge,
  claimCommentAction,
  createPrefilledChatCheckoutLink,
  ensureSocialThread,
  findChatInventory,
  findCommentRule,
  finishCartNudge,
  finishCommentAction,
  getCloserContext,
  listCartRecoveryCandidates,
  listUnansweredCloserThreads,
  markConvertedThreads,
  pauseThreadAi,
  postIdVariants,
  resumeThreadAi,
  setSocialAccountCloserMode,
} from "./queries/social-automation";
import {
  abandonedCartNudges,
  checkoutLinkItems,
  checkoutLinks,
  contentQueue,
  orderItems,
  orderStatusHistory,
  orders,
  productVariants,
  products,
  socialAccounts,
  socialAutomationRules,
  socialCommentActions,
  socialMessages,
  socialThreads,
  stockMovements,
  tenants,
} from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const shop = { id: "", slug: `test-closer-${run}` };
const starter = { id: "", slug: `test-closer-s-${run}` };
const ids = { tracked: "", trackedVar: "", untracked: "", untrackedVar: "", account: "", starterAccount: "" };

before(async () => {
  for (const [t, plan] of [
    [shop, "pro_live"],
    [starter, "starter"],
  ] as const) {
    const [row] = await db.insert(tenants).values({ slug: t.slug, name: `Shop ${t.slug}`, status: "active", subscriptionPlan: plan }).returning();
    t.id = row!.id;
  }
  const [a] = await db.insert(products).values({ tenantId: shop.id, title: "Ube Cheese Pandesal", slug: `ube-${run}`, status: "active", basePrice: "240.00", trackInventory: true }).returning();
  const [av] = await db.insert(productVariants).values({ productId: a!.id, title: "Box of 12", price: "240.00", stockQty: 7, sku: `UBE-${run}` }).returning();
  const [b] = await db.insert(products).values({ tenantId: shop.id, title: "Made-to-order Leche Flan", slug: `flan-${run}`, status: "active", basePrice: "180.00", trackInventory: false }).returning();
  const [bv] = await db.insert(productVariants).values({ productId: b!.id, title: "Default", price: "180.00", stockQty: 0, sku: `FLAN-${run}` }).returning();
  const acc = await upsertSocialAccount({ tenantId: shop.id, platform: "messenger", externalId: `page-${run}`, name: "Ube Page", pageId: `page-${run}`, accessTokenSealed: null, status: "mock" });
  const acc2 = await upsertSocialAccount({ tenantId: starter.id, platform: "messenger", externalId: `page-s-${run}`, name: "Starter Page", pageId: `page-s-${run}`, accessTokenSealed: null, status: "mock" });
  Object.assign(ids, { tracked: a!.id, trackedVar: av!.id, untracked: b!.id, untrackedVar: bv!.id, account: acc.id, starterAccount: acc2.id });
});

after(async () => {
  const tid = [shop.id, starter.id];
  const shopOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.tenantId, tid));
  await db.delete(abandonedCartNudges).where(inArray(abandonedCartNudges.tenantId, tid)).catch(() => undefined);
  await db.delete(socialCommentActions).where(inArray(socialCommentActions.tenantId, tid)).catch(() => undefined);
  await db.delete(socialAutomationRules).where(inArray(socialAutomationRules.tenantId, tid)).catch(() => undefined);
  await db.delete(contentQueue).where(inArray(contentQueue.tenantId, tid)).catch(() => undefined);
  // Orders, payments and stock movements are append-only (security G3): test shops are left in place, renamed by run id.
  await db.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, shopOrders)).catch(() => undefined);
  await db.delete(orderItems).where(inArray(orderItems.orderId, shopOrders)).catch(() => undefined);
  await db.delete(orders).where(inArray(orders.tenantId, tid)).catch(() => undefined);
  await db.delete(stockMovements).where(inArray(stockMovements.tenantId, tid)).catch(() => undefined);
  await db.update(socialThreads).set({ activeCheckoutLinkId: null }).where(inArray(socialThreads.tenantId, tid)).catch(() => undefined);
  const links = db.select({ id: checkoutLinks.id }).from(checkoutLinks).where(inArray(checkoutLinks.tenantId, tid));
  await db.delete(checkoutLinkItems).where(inArray(checkoutLinkItems.linkId, links)).catch(() => undefined);
  await db.delete(checkoutLinks).where(inArray(checkoutLinks.tenantId, tid)).catch(() => undefined);
  await db.delete(socialMessages).where(inArray(socialMessages.tenantId, tid)).catch(() => undefined);
  await db.delete(socialThreads).where(inArray(socialThreads.tenantId, tid)).catch(() => undefined);
  await db.delete(socialAccounts).where(inArray(socialAccounts.tenantId, tid)).catch(() => undefined);
  const prods = db.select({ id: products.id }).from(products).where(inArray(products.tenantId, tid));
  await db.delete(productVariants).where(inArray(productVariants.productId, prods)).catch(() => undefined);
  await db.delete(products).where(inArray(products.tenantId, tid)).catch(() => undefined);
  await db.delete(tenants).where(inArray(tenants.id, tid)).catch(() => undefined);
  await closeDb();
});

async function buyerThread(tenantId: string, accountId: string, user: string, text = "HM po?") {
  const r = await recordSocialMessage({ account: { id: accountId, tenantId, platform: "messenger" }, userId: user, messageId: `m-${randomUUID()}`, text, kind: "text", at: new Date() });
  return r.threadId;
}

describe("comment-to-DM rules", () => {
  it("post-specific rule beats the global rule; pending studio rules never match; ids match with or without the Page prefix", async () => {
    assert.deepEqual(postIdVariants("111_222"), ["111_222", "222"]);
    await db.insert(socialAutomationRules).values({ tenantId: shop.id, triggerKeywords: ["HM"], publicReplyTemplates: ["DM sent po"] });
    const [cq] = await db.insert(contentQueue).values({ tenantId: shop.id, agentKey: "ai_copywriter", platform: "facebook", title: "Ube", body: "Ube", status: "approved", outputJson: { productId: ids.tracked } }).returning();
    await db.insert(socialAutomationRules).values({ tenantId: shop.id, contentQueueId: cq!.id, triggerKeywords: ["MINE"], publicReplyTemplates: ["Check inbox po"] }); // pending
    const global = await findCommentRule(shop.id, ids.account, `page-${run}_999`);
    assert.equal(global!.postSpecific, false);
    assert.deepEqual(global!.keywords, ["HM"]);
    await db.update(socialAutomationRules).set({ postId: `pg_555${run.replace(/\D/g, "")}` }).where(eq(socialAutomationRules.contentQueueId, cq!.id));
    const specific = await findCommentRule(shop.id, ids.account, `555${run.replace(/\D/g, "")}`);
    assert.equal(specific!.postSpecific, true, "bare incoming id matches stored <page>_<post>");
    assert.equal(specific!.productId, ids.tracked, "product comes from the studio post");
    assert.equal(await findCommentRule(starter.id, ids.starterAccount, "1"), null);
  });

  it("each comment is handled once; the same commenter isn't DMed twice for the same post", async () => {
    const input = { tenantId: shop.id, accountId: ids.account, platform: "messenger" as const, commentId: `c-${run}`, postId: "p1", commenterId: "u1", commenterName: "Ana Cruz", text: "mine" };
    const first = await claimCommentAction(input);
    assert.ok(first);
    assert.equal(await claimCommentAction(input), null, "webhook retry");
    assert.equal(await alreadyMessagedCommenter(shop.id, ids.account, "p1", "u1"), false);
    await finishCommentAction(shop.id, first!, { status: "replied", matchedKeyword: "mine", privateReplyId: "mid.1" });
    assert.equal(await alreadyMessagedCommenter(shop.id, ids.account, "p1", "u1"), true);
    assert.equal(await alreadyMessagedCommenter(shop.id, ids.account, "p2", "u1"), false);
    const t1 = await ensureSocialThread({ tenantId: shop.id, accountId: ids.account, platform: "messenger", externalUserId: `psid-${run}`, buyerName: "Ana Cruz" });
    const t2 = await ensureSocialThread({ tenantId: shop.id, accountId: ids.account, platform: "messenger", externalUserId: `psid-${run}`, buyerName: "Other" });
    assert.equal(t1, t2);
  });
});

describe("closer tools", () => {
  it("inventory: real prices; exact counts only for tracked stock (D5)", async () => {
    const [ube] = await findChatInventory(shop.id, { text: "ube pandesal po" });
    assert.equal(ube!.title, "Ube Cheese Pandesal");
    assert.deepEqual(ube!.variants.map((v) => [v.price, v.inStock, v.stockLeft]), [[240, true, 7]]);
    const [flan] = await findChatInventory(shop.id, { productId: ids.untracked });
    assert.deepEqual(flan!.variants.map((v) => [v.inStock, v.stockLeft]), [[true, null]], "untracked: available, no number");
    assert.deepEqual(await findChatInventory(starter.id, { productId: ids.tracked }), [], "other shop's product is invisible");
  });

  it("prefilled link: only methods the shop takes; details cleaned and shown until the first order", async () => {
    const threadId = await buyerThread(shop.id, ids.account, `buyer-link-${run}`);
    const methods = await availableChatPaymentMethods(shop.id);
    assert.ok(methods.includes("cod"), `default shop takes COD (got ${methods.join(",")})`);
    const missing = (["gcash", "maya", "qrph"] as const).find((m) => !methods.includes(m));
    if (missing) {
      const no = await createPrefilledChatCheckoutLink(shop.id, { threadId, items: [{ productId: ids.tracked, quantity: 1 }], paymentMethod: missing, prefill: {} });
      assert.equal(no.ok, false);
      assert.equal(no.ok === false && no.reason, "payment_unavailable");
    }
    const res = await createPrefilledChatCheckoutLink(shop.id, {
      threadId,
      items: [{ productId: ids.tracked, variantId: ids.trackedVar, quantity: 2 }],
      paymentMethod: "cod",
      prefill: { name: "  Ana Cruz ", phone: "+63 917 123 4567", addressLine: "12 Mabini St", barangay: "Kapitolyo", city: "Pasig", landmark: "near 7-Eleven" },
    });
    assert.ok(res.ok);
    const [link] = await db.select().from(checkoutLinks).where(eq(checkoutLinks.id, res.ok ? res.linkId : ""));
    assert.deepEqual(link!.paymentMethods, ["cod"]);
    assert.equal(link!.origin, "ai_auto");
    assert.equal(link!.socialThreadId, threadId);
    assert.equal(link!.prefillJson!.phone, "09171234567");
    assert.equal(link!.prefillJson!.name, "Ana Cruz");
    const [th] = await db.select().from(socialThreads).where(eq(socialThreads.id, threadId));
    assert.equal(th!.activeCheckoutLinkId, link!.id);
    assert.ok(th!.checkoutLinkSentAt);
    assert.equal(th!.conversionStatus, "checkout_started");
    const pub = await getCheckoutLinkByCode(link!.code);
    assert.equal(pub!.prefill!.city, "Pasig");
    await createOrderForTenant({ tenantSlug: shop.slug, items: [{ productId: ids.tracked, variantId: ids.trackedVar, quantity: 2 }], customer: { name: "Ana Cruz", phone: "09171234567" }, deliveryType: "pickup", paymentMethod: "cod", deliveryFee: 0, minOrderAmount: 0, checkoutLinkId: link!.id });
    assert.equal((await getCheckoutLinkByCode(link!.code))!.prefill, null, "hidden once someone ordered from it");
  });
});

describe("closer state", () => {
  it("closer is on for Pro Live with the account in auto; pause / resume; per-account off switch", async () => {
    const threadId = await buyerThread(shop.id, ids.account, `buyer-state-${run}`, "hi po");
    let ctx = await getCloserContext(shop.id, threadId);
    assert.equal(ctx!.closerEnabled, true);
    assert.equal(ctx!.messages.at(-1)!.direction, "in");
    assert.ok(await pauseThreadAi(shop.id, threadId, "wholesale"));
    ctx = await getCloserContext(shop.id, threadId);
    assert.deepEqual([ctx!.thread.aiPaused, ctx!.thread.escalationReason, ctx!.thread.conversionStatus], [true, "wholesale", "escalated"]);
    assert.ok(await resumeThreadAi(shop.id, threadId));
    ctx = await getCloserContext(shop.id, threadId);
    assert.equal(ctx!.thread.aiPaused, false);
    assert.equal(await pauseThreadAi(starter.id, threadId, "x"), false, "other shop can't pause it");
    await setSocialAccountCloserMode(shop.id, ids.account, "off");
    assert.equal((await getCloserContext(shop.id, threadId))!.closerEnabled, false);
    await setSocialAccountCloserMode(shop.id, ids.account, "auto");
    const s = await buyerThread(starter.id, ids.starterAccount, `buyer-s-${run}`);
    assert.equal((await getCloserContext(starter.id, s))!.closerEnabled, false, "Starter has no closer");
  });

  it("unanswered sweep: buyer's last message 90 s – 20 min old, closer shops only, not paused", async () => {
    const threadId = await buyerThread(shop.id, ids.account, `buyer-sweep-${run}`, "avail pa?");
    const age = async (id: string, secs: number) => db.execute(sql`update social_messages set created_at = now() - make_interval(secs => ${secs}) where thread_id = ${id}`);
    const mine = async () => (await listUnansweredCloserThreads({ limit: 500 })).map((r) => r.threadId);
    assert.ok(!(await mine()).includes(threadId), "too fresh — the webhook run is still on it");
    await age(threadId, 180);
    assert.ok((await mine()).includes(threadId));
    await pauseThreadAi(shop.id, threadId, "x");
    assert.ok(!(await mine()).includes(threadId));
    await resumeThreadAi(shop.id, threadId);
    await age(threadId, 3600);
    assert.ok(!(await mine()).includes(threadId), "too old to answer out of the blue");
    const s = await buyerThread(starter.id, ids.starterAccount, `buyer-s2-${run}`);
    await age(s, 180);
    assert.ok(!(await mine()).includes(s));
  });
});

describe("abandoned-cart & ghost-buyer recovery", () => {
  async function linkedThread(user: string, opts: { sentMinAgo: number; inboundMinAgo: number }) {
    const threadId = await buyerThread(shop.id, ids.account, user, "sige po");
    const res = await createPrefilledChatCheckoutLink(shop.id, { threadId, items: [{ productId: ids.untracked, quantity: 1 }], paymentMethod: "cod", prefill: { name: "Ben" } });
    assert.ok(res.ok);
    await db
      .update(socialThreads)
      .set({ checkoutLinkSentAt: new Date(Date.now() - opts.sentMinAgo * 60_000), lastInboundAt: new Date(Date.now() - opts.inboundMinAgo * 60_000) })
      .where(eq(socialThreads.id, threadId));
    return { threadId, linkId: res.ok ? res.linkId : "" };
  }
  const candidateIds = async () => (await listCartRecoveryCandidates({ limit: 500 })).filter((c) => c.tenantId === shop.id);

  it("30 minutes after the link, inside Meta's 24 h window, not paid → one nudge", async () => {
    const ghost = await linkedThread(`ghost-${run}`, { sentMinAgo: 31, inboundMinAgo: 40 });
    const fresh = await linkedThread(`fresh-${run}`, { sentMinAgo: 10, inboundMinAgo: 12 });
    const late = await linkedThread(`late-${run}`, { sentMinAgo: 60 * 23, inboundMinAgo: 60 * 23 + 45 }); // window closes in < 30 min
    let c = await candidateIds();
    const ghostRow = c.find((x) => x.threadId === ghost.threadId);
    assert.ok(ghostRow, "ghost buyer is due");
    assert.equal(ghostRow!.orderId, null);
    assert.equal(ghostRow!.closerEnabled, true);
    assert.deepEqual(ghostRow!.linkPaymentMethods, ["cod"]);
    assert.ok(!c.some((x) => x.threadId === fresh.threadId), "not yet 30 minutes");
    assert.ok(!c.some((x) => x.threadId === late.threadId), "Meta's window is about to close");

    const nudge = await claimCartNudge({ tenantId: shop.id, threadId: ghost.threadId, checkoutLinkId: ghost.linkId, channel: "messenger" });
    assert.ok(nudge);
    assert.equal(await claimCartNudge({ tenantId: shop.id, threadId: ghost.threadId, checkoutLinkId: ghost.linkId, channel: "messenger" }), null, "overlapping cron runs");
    await finishCartNudge(shop.id, nudge!, ghost.threadId, { status: "sent", body: "Hi Ben!" });
    c = await candidateIds();
    assert.ok(!c.some((x) => x.threadId === ghost.threadId), "one nudge per link");
  });

  it("unpaid orders are nudged with the buyer's own order page; paid / COD orders are not and get marked converted", async () => {
    const unpaid = await linkedThread(`unpaid-${run}`, { sentMinAgo: 45, inboundMinAgo: 50 });
    const cod = await linkedThread(`cod-${run}`, { sentMinAgo: 45, inboundMinAgo: 50 });
    const mk = (linkId: string, paymentMethod: "gcash" | "cod") =>
      createOrderForTenant({ tenantSlug: shop.slug, items: [{ productId: ids.untracked, quantity: 1 }], customer: { name: "Ben", phone: "09171112222" }, deliveryType: "pickup", paymentMethod, deliveryFee: 0, minOrderAmount: 0, checkoutLinkId: linkId });
    const o1 = await mk(unpaid.linkId, "gcash");
    await db.update(orders).set({ paymentState: "unpaid" }).where(eq(orders.id, o1.id));
    const o2 = await mk(cod.linkId, "cod");
    const [o2row] = await db.select({ ps: orders.paymentState }).from(orders).where(eq(orders.id, o2.id));
    const c = await candidateIds();
    const u = c.find((x) => x.threadId === unpaid.threadId);
    assert.ok(u);
    assert.equal(u!.orderId, o1.id);
    assert.match(u!.orderPath!, new RegExp(`^/${shop.slug}/orders/.+\\?t=.+`));
    const codDue = ["cod_due", "pending_verification", "paid"].includes(String(o2row!.ps));
    assert.equal(c.some((x) => x.threadId === cod.threadId), !codDue, `COD order (${o2row!.ps}) counts as done`);
    await markConvertedThreads();
    const [t] = await db.select({ s: socialThreads.conversionStatus }).from(socialThreads).where(eq(socialThreads.id, cod.threadId));
    if (codDue) assert.equal(t!.s, "converted");
    const [tu] = await db.select({ s: socialThreads.conversionStatus }).from(socialThreads).where(eq(socialThreads.id, unpaid.threadId));
    assert.notEqual(tu!.s, "converted");
  });
});
