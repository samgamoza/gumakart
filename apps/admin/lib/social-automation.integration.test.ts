/**
 * AI suite Phase 3 end-to-end through the admin glue: comment-to-DM, the AI closer (tool calls via
 * a fake signed GPU bridge), escalation, the 30-minute recovery nudge and "Switch to COD".
 * Sends run in mock mode (NODE_ENV=test, no Page tokens). Needs DATABASE_URL (local Postgres).
 * Run: pnpm --filter @gumakart/admin test:integration
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("DATABASE_URL is not set (use the local Postgres).");
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(dbUrl)) throw new Error("Refusing to run against a hosted database.");
(process.env as Record<string, string>).NODE_ENV = "test";

type Msg = { role: string; content: string; tool_calls?: unknown[] };
const seen: Array<{ purpose: string; tools: number; last: string }> = [];

/** Fake GPU bridge /v1/realtime/chat: scripted Qwen3 with native tool calls. */
function fakeBridge(): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { purpose: string; request: { messages: Msg[]; tools?: unknown[] } };
      const msgs = body.request.messages;
      const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
      const toolMsgs = msgs.filter((m) => m.role === "tool");
      seen.push({ purpose: body.purpose, tools: body.request.tools?.length ?? 0, last: lastUser });
      const reply = (content: string, toolCalls: unknown[] = []) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, content, model: "qwen3-235b", toolCalls, usage: { promptTokens: 40, completionTokens: 10 }, finishReason: toolCalls.length ? "tool_calls" : "stop" }));
      };
      const call = (name: string, args: unknown) => [{ id: `call_${toolMsgs.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }];
      if (body.purpose === "cart_nudge") return reply(JSON.stringify({ message: "Hi Ben! Nakita namin na hindi mo pa natatapos ang order mo. Need help? 😊" }));
      if (/wholesale/i.test(lastUser)) {
        return toolMsgs.length ? reply("Ipapasa ko po sa seller para sa wholesale price 😊") : reply("", call("escalate_to_human_seller", { reason: "wholesale 50 boxes" }));
      }
      if (toolMsgs.length === 0) return reply("", call("check_product_inventory", { product_query: "ube pandesal" }));
      if (toolMsgs.length === 1) {
        const inv = JSON.parse(toolMsgs[0]!.content) as { products: Array<{ product_id: string; variants: Array<{ variant_id: string }> }> };
        const p = inv.products[0]!;
        return reply("", call("create_prefilled_checkout_link", { items: [{ product_id: p.product_id, variant_id: p.variants[0]!.variant_id, quantity: 2 }], payment_method: "cod", buyer: { name: "Ben Santos", phone: "0917 555 0101", city: "Pasig" } }));
      }
      return reply("Sige po! ₱240 per box, 2 boxes = ₱480. Naka-fill na details mo, i-confirm mo lang:");
    });
  });
}

let server: Server;
let lib: typeof import("./social-automation");
let db: typeof import("@gumakart/db");
const run = randomUUID().slice(0, 8);
const ids = { tenant: "", product: "", variant: "", account: "" };

before(async () => {
  server = fakeBridge();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.GPU_BRIDGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GPU_BRIDGE_SECRET = "integration-secret-".repeat(3);
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  db = await import("@gumakart/db");
  lib = await import("./social-automation");
  const d = db.getDb();
  const [t] = await d.insert(db.tenants).values({ slug: `test-p3-${run}`, name: "P3 Bakery", status: "active", subscriptionPlan: "pro_live" }).returning();
  const [p] = await d.insert(db.products).values({ tenantId: t!.id, title: "Ube Cheese Pandesal", slug: `ube-${run}`, status: "active", basePrice: "240.00", trackInventory: true }).returning();
  const [v] = await d.insert(db.productVariants).values({ productId: p!.id, title: "Box of 12", price: "240.00", stockQty: 20, sku: `P3-${run}` }).returning();
  const acc = await db.upsertSocialAccount({ tenantId: t!.id, platform: "messenger", externalId: `page-p3-${run}`, name: "P3 Page", pageId: `page-p3-${run}`, accessTokenSealed: null, status: "mock" });
  await d.insert(db.socialAutomationRules).values({ tenantId: t!.id, productId: p!.id, triggerKeywords: ["HM", "MINE"], publicReplyTemplates: ["Check inbox po {name}!"] });
  Object.assign(ids, { tenant: t!.id, product: p!.id, variant: v!.id, account: acc.id });
});

after(async () => {
  server?.close();
  // Test shops stay (orders / payments are append-only); everything is keyed by the run id.
  await db?.closeDb();
});

const comment = (over: Partial<import("@gumakart/services").MetaCommentEvent> = {}) => ({
  platform: "messenger" as const,
  accountExternalId: `page-p3-${run}`,
  commentId: `cm-${randomUUID()}`,
  postId: `page-p3-${run}_123`,
  parentId: null,
  fromId: `fb-${run}`,
  fromName: "Ben Santos",
  text: "HM po?",
  at: new Date(),
  isOwn: false,
  ...over,
});

describe("Phase 3 e2e (admin glue + DB + fake bridge)", () => {
  let threadId = "";

  it("comment-to-DM: keyword → private reply with the product + checkout link, public reply, thread recorded; retries and noise ignored", async () => {
    const ev = comment();
    assert.deepEqual(await lib.handleCommentEvent(ev), { status: "replied" });
    assert.deepEqual(await lib.handleCommentEvent(ev), { status: "duplicate" });
    assert.deepEqual(await lib.handleCommentEvent(comment({ text: "Ang ganda!", fromId: "other" })), { status: "skipped", reason: "no_keyword" });
    assert.deepEqual(await lib.handleCommentEvent(comment({ isOwn: true })), { status: "ignored" });
    assert.deepEqual(await lib.handleCommentEvent(comment({ text: "mine po" })), { status: "skipped", reason: "already_messaged" });
    const d = db.getDb();
    const { eq, and } = await import("drizzle-orm");
    const [action] = await d.select().from(db.socialCommentActions).where(and(eq(db.socialCommentActions.tenantId, ids.tenant), eq(db.socialCommentActions.commentId, ev.commentId)));
    assert.equal(action!.status, "replied");
    assert.equal(action!.matchedKeyword, "HM");
    assert.ok(action!.threadId);
    threadId = action!.threadId!;
    const [msg] = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, threadId));
    assert.equal(msg!.direction, "out");
    assert.equal(msg!.aiOrigin, "auto");
    assert.equal(msg!.kind, "product");
    assert.match(msg!.body, /Ube Cheese Pandesal — ₱240/);
  });

  it("AI closer: the buyer replies → inventory → prefilled COD link → reply with the link (mock send), usage recorded", async () => {
    const d = db.getDb();
    const { eq } = await import("drizzle-orm");
    const [thread] = await d.select().from(db.socialThreads).where(eq(db.socialThreads.id, threadId));
    await db.recordSocialMessage({ account: { id: ids.account, tenantId: ids.tenant, platform: "messenger" }, userId: thread!.externalUserId, messageId: `in-${randomUUID()}`, text: "2 box po, COD. Pasig.", kind: "text", at: new Date() });
    const out = await lib.runCloserForThread(ids.tenant, threadId);
    assert.equal(out.status, "sent", JSON.stringify(out));
    assert.equal(out.servedBy, "gpu-node");
    assert.match(out.checkoutUrl!, /\/c\/[A-Za-z0-9]+\?ref=messenger&th=/);
    const closerCalls = seen.filter((s) => s.purpose === "dm_closer");
    assert.equal(closerCalls.length, 3);
    assert.ok(closerCalls.every((c) => c.tools === 4));
    const msgs = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, threadId));
    const ai = msgs.filter((m) => m.direction === "out" && m.sentByName === "Guma AI").at(-1)!;
    assert.equal(ai.kind, "link");
    assert.ok(ai.body.includes(out.checkoutUrl!));
    assert.equal(ai.status, "mock");
    const [t2] = await d.select().from(db.socialThreads).where(eq(db.socialThreads.id, threadId));
    assert.ok(t2!.activeCheckoutLinkId);
    const [link] = await d.select().from(db.checkoutLinks).where(eq(db.checkoutLinks.id, t2!.activeCheckoutLinkId!));
    assert.deepEqual(link!.paymentMethods, ["cod"]);
    assert.deepEqual(link!.prefillJson, { name: "Ben Santos", phone: "09175550101", city: "Pasig", paymentMethod: "cod" });
    assert.equal((await lib.runCloserForThread(ids.tenant, threadId)).reason, "nothing_to_answer", "already answered");
    const usage = await db.getRawAiUsageCounts(ids.tenant);
    assert.ok(usage.tokensThisMonth >= 150);
  });

  it("30 minutes later, still unpaid → one recovery nudge with Finish / Switch-to-COD buttons; Switch to COD makes a fresh link", async () => {
    const d = db.getDb();
    const { eq } = await import("drizzle-orm");
    await d.update(db.socialThreads).set({ checkoutLinkSentAt: new Date(Date.now() - 31 * 60_000) }).where(eq(db.socialThreads.id, threadId));
    const r1 = await lib.runCartRecovery();
    assert.ok(r1.sent >= 1, JSON.stringify(r1));
    const r2 = await lib.runCartRecovery();
    const [t] = await d.select().from(db.socialThreads).where(eq(db.socialThreads.id, threadId));
    assert.ok(t!.nudgeSentAt);
    assert.equal((await db.listCartRecoveryCandidates({ limit: 500 })).some((c) => c.threadId === threadId), false);
    assert.equal(r2.sent, 0);
    const msgs = await d.select().from(db.socialMessages).where(eq(db.socialMessages.threadId, threadId));
    const nudge = msgs.find((m) => (m.payloadJson as { cartNudge?: unknown } | null)?.cartNudge);
    assert.ok(nudge, "nudge recorded in the chat");
    assert.ok(!/reserve/i.test(nudge!.body));
    const cn = (nudge!.payloadJson as { cartNudge: { codButton: boolean; servedBy: string } }).cartNudge;
    assert.equal(cn.codButton, false, "link is already COD — no switch button");
    assert.equal(cn.servedBy, "gpu-node");
    const sw = await lib.handleCloserPostback({ tenantId: ids.tenant, threadId, payload: `CLOSER:SWITCH_COD:${t!.activeCheckoutLinkId}` });
    assert.equal(sw.status, "sent");
    assert.match(sw.checkoutUrl!, /\/c\//);
  });

  it("escalation pauses the AI and it stays quiet until the seller resumes; a seller typing recently also keeps it quiet", async () => {
    const d = db.getDb();
    const { eq } = await import("drizzle-orm");
    const [thread] = await d.select().from(db.socialThreads).where(eq(db.socialThreads.id, threadId));
    const buyer = (text: string) =>
      db.recordSocialMessage({ account: { id: ids.account, tenantId: ids.tenant, platform: "messenger" }, userId: thread!.externalUserId, messageId: `in-${randomUUID()}`, text, kind: "text", at: new Date() });
    await buyer("Pwede wholesale 50 boxes?");
    const esc = await lib.runCloserForThread(ids.tenant, threadId);
    assert.equal(esc.status, "sent");
    assert.equal(esc.escalated, true);
    const [paused] = await d.select().from(db.socialThreads).where(eq(db.socialThreads.id, threadId));
    assert.equal(paused!.aiPaused, true);
    assert.equal(paused!.escalationReason, "wholesale 50 boxes");
    await buyer("hello?");
    assert.equal((await lib.runCloserForThread(ids.tenant, threadId)).reason, "paused");
    await db.resumeThreadAi(ids.tenant, threadId);
    const draft = await db.beginSocialSend({ tenantId: ids.tenant, threadId, kind: "text", body: "Hi! Seller here.", sentByName: "Owner" });
    await db.finishSocialSend(ids.tenant, threadId, draft.messageId, { success: true, mock: true }, "Hi! Seller here.");
    await buyer("ok po");
    assert.equal((await lib.runCloserForThread(ids.tenant, threadId)).reason, "seller_active");
  });
});
