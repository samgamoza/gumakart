/** AI Marketing Suite Phase 2 (migration 0048): Save to Post & Attach Comment-to-DM Trigger. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { attachPublishedPost, countPendingStudioTriggers, listStudioPosts, saveStudioPost } from "./queries/studio-posts";
import { contentQueue, socialAutomationRules, tenants } from "./schema/index";

const url = process.env.DATABASE_URL ?? "";
if (/neon\.tech|neon\.database|amazonaws|supabase|render\.com/i.test(url)) throw new Error("Refusing to run destructive tests against a hosted database.");
if (!url) throw new Error("DATABASE_URL is not set (use the local Postgres).");

const db = getDb();
const run = randomUUID().slice(0, 8);
const made: string[] = [];
async function shop() {
  const [t] = await db.insert(tenants).values({ slug: `test-studio-${run}-${made.length}`, name: "Studio shop", status: "active", subscriptionPlan: "starter" }).returning({ id: tenants.id });
  made.push(t!.id);
  return t!.id;
}
const post = (tenantId: string, attachTrigger = true, extra: Partial<Parameters<typeof saveStudioPost>[0]> = {}) =>
  saveStudioPost({ tenantId, platform: "facebook", title: "Ube pandesal!", body: "Ube pandesal ₱240", mediaUrls: ["https://media.guma.one/ai-media/x/1.png"], copy: { hooks: ["Ube!"] }, attachTrigger, ...extra });

after(async () => {
  await db.delete(socialAutomationRules).where(inArray(socialAutomationRules.tenantId, made)).catch(() => undefined);
  await db.delete(contentQueue).where(inArray(contentQueue.tenantId, made)).catch(() => undefined);
  await closeDb();
});

describe("studio posts + pending comment-to-DM triggers", () => {
  it("saves an approved post with a pending rule; defaults and keyword cleanup apply", async () => {
    const t = await shop();
    const r = await post(t, true, { triggerKeywords: [" mine ", "MINE", "hm", ""] });
    assert.ok(r.ruleId);
    const [rule] = await db.select().from(socialAutomationRules).where(eq(socialAutomationRules.id, r.ruleId!));
    assert.deepEqual(rule!.triggerKeywords, ["mine", "hm"]);
    assert.equal(rule!.publicReplyTemplates.length, 3, "DB default replies");
    assert.equal(rule!.postId, null);
    assert.equal(rule!.contentQueueId, r.postId);
    const [cq] = await db.select().from(contentQueue).where(eq(contentQueue.id, r.postId));
    assert.equal(cq!.status, "approved");
    assert.equal(cq!.agentKey, "ai_copywriter");
    assert.equal(await countPendingStudioTriggers(t), 1);
    const noTrigger = await post(t, false);
    assert.equal(noTrigger.ruleId, null);
  });

  it("many pending posts can coexist with the shop's global rule (0048 index rebuild)", async () => {
    const t = await shop();
    await db.insert(socialAutomationRules).values({ tenantId: t, triggerKeywords: ["HM"], publicReplyTemplates: ["DM sent po"] });
    await post(t);
    await post(t);
    assert.equal(await countPendingStudioTriggers(t), 2);
    await assert.rejects(db.insert(socialAutomationRules).values({ tenantId: t, triggerKeywords: ["x"], publicReplyTemplates: ["y"] }), /duplicate key/, "still one global rule");
    const globals = await db.select().from(socialAutomationRules).where(and(eq(socialAutomationRules.tenantId, t), isNull(socialAutomationRules.postId), isNull(socialAutomationRules.contentQueueId)));
    assert.equal(globals.length, 1);
  });

  it("pasting the post link activates the trigger; one trigger per post; other shops can't touch it", async () => {
    const t = await shop();
    const other = await shop();
    const a = await post(t);
    const b = await post(t);
    assert.deepEqual(await attachPublishedPost(other, a.postId, "111_222", null), { ok: false, reason: "not_found" });
    assert.deepEqual(await attachPublishedPost(t, a.postId, "111_222", "https://facebook.com/x/posts/222"), { ok: true });
    const [rule] = await db.select().from(socialAutomationRules).where(eq(socialAutomationRules.contentQueueId, a.postId));
    assert.deepEqual([rule!.postId, rule!.postUrl], ["111_222", "https://facebook.com/x/posts/222"]);
    assert.deepEqual(await attachPublishedPost(t, b.postId, "111_222", null), { ok: false, reason: "already_attached_elsewhere" });
    const list = await listStudioPosts(t);
    assert.equal(list.length, 2);
    const posted = list.find((p) => p.id === a.postId)!;
    assert.equal(posted.status, "posted");
    assert.ok(posted.postedAt);
    assert.deepEqual(posted.mediaUrls, ["https://media.guma.one/ai-media/x/1.png"]);
    assert.equal(posted.trigger!.postId, "111_222");
    assert.equal(await countPendingStudioTriggers(t), 1);
    assert.equal((await listStudioPosts(other)).length, 0);
  });

  it("deleting the post removes its trigger (cascade)", async () => {
    const t = await shop();
    const a = await post(t);
    await db.delete(contentQueue).where(and(eq(contentQueue.id, a.postId), eq(contentQueue.tenantId, t)));
    assert.equal((await db.select().from(socialAutomationRules).where(eq(socialAutomationRules.id, a.ruleId!))).length, 0);
  });
});
