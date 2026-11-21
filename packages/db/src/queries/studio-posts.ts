import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { contentQueue, socialAutomationRules } from "../schema/index";

/**
 * AI Marketing Suite Phase 2 — "Save to Post & Attach Comment-to-DM Trigger".
 * A copywriter result becomes an approved content_queue post; optionally a comment-to-DM rule is
 * attached. The rule stays pending (post_id NULL) until the seller pastes the live post link.
 */

export const DEFAULT_TRIGGER_KEYWORDS = ["HM", "MINE", "Available pa?", "Details", "Magkano"];

export interface SaveStudioPostInput {
  tenantId: string;
  platform: "facebook" | "instagram" | "tiktok";
  title: string;
  body: string;
  mediaUrls: string[];
  productId?: string | null;
  link?: string | null;
  copy: Record<string, unknown>;
  attachTrigger: boolean;
  triggerKeywords?: string[];
  publicReplyTemplates?: string[];
}

export interface StudioPost {
  id: string;
  platform: string;
  title: string | null;
  body: string;
  status: string;
  createdAt: Date;
  postedAt: Date | null;
  mediaUrls: string[];
  trigger: { id: string; keywords: string[]; postId: string | null; postUrl: string | null; isActive: boolean } | null;
}

function cleanKeywords(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const k of list ?? DEFAULT_TRIGGER_KEYWORDS) {
    const t = k.trim().slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return (out.length ? out : DEFAULT_TRIGGER_KEYWORDS).slice(0, 15);
}

export async function saveStudioPost(input: SaveStudioPostInput): Promise<{ postId: string; ruleId: string | null }> {
  return getDb().transaction(async (tx) => {
    const [post] = await tx
      .insert(contentQueue)
      .values({
        tenantId: input.tenantId,
        agentKey: "ai_copywriter",
        platform: input.platform,
        title: input.title.slice(0, 255),
        body: input.body,
        mediaBrief: input.mediaUrls.length ? `${input.mediaUrls.length} Marketing Studio asset(s)` : null,
        status: "approved",
        outputJson: { source: "marketing_studio", copy: input.copy, mediaUrls: input.mediaUrls, productId: input.productId ?? null, link: input.link ?? null },
      })
      .returning({ id: contentQueue.id });
    if (!post) throw new Error("could not save post");
    if (!input.attachTrigger) return { postId: post.id, ruleId: null };
    const [rule] = await tx
      .insert(socialAutomationRules)
      .values({
        tenantId: input.tenantId,
        contentQueueId: post.id,
        productId: input.productId ?? null,
        triggerKeywords: cleanKeywords(input.triggerKeywords),
        publicReplyTemplates: input.publicReplyTemplates?.length
          ? input.publicReplyTemplates.map((t) => t.slice(0, 300)).slice(0, 5)
          : sql`DEFAULT`,
        dmFlowConfig: { productId: input.productId ?? null, link: input.link ?? null, source: "marketing_studio" },
      })
      .returning({ id: socialAutomationRules.id });
    return { postId: post.id, ruleId: rule?.id ?? null };
  });
}

export type AttachPostResult = { ok: true } | { ok: false; reason: "not_found" | "already_attached_elsewhere" };

/** The seller published the post: activate its trigger for that platform post id. */
export async function attachPublishedPost(tenantId: string, contentQueueId: string, postId: string, postUrl: string | null): Promise<AttachPostResult> {
  try {
    return await getDb().transaction(async (tx) => {
      const [post] = await tx
        .update(contentQueue)
        .set({ status: "posted", postedAt: sql`coalesce(${contentQueue.postedAt}, now())` })
        .where(and(eq(contentQueue.id, contentQueueId), eq(contentQueue.tenantId, tenantId)))
        .returning({ id: contentQueue.id });
      if (!post) return { ok: false, reason: "not_found" } as const;
      await tx
        .update(socialAutomationRules)
        .set({ postId, postUrl, updatedAt: sql`now()` })
        .where(and(eq(socialAutomationRules.contentQueueId, contentQueueId), eq(socialAutomationRules.tenantId, tenantId)));
      return { ok: true } as const;
    });
  } catch (error) {
    if (error instanceof Error && /social_automation_rules_scope_idx|duplicate key/.test(error.message + String((error as { cause?: unknown }).cause ?? ""))) {
      return { ok: false, reason: "already_attached_elsewhere" };
    }
    throw error;
  }
}

export async function listStudioPosts(tenantId: string, limit = 20): Promise<StudioPost[]> {
  const rows = await getDb()
    .select({ post: contentQueue, rule: socialAutomationRules })
    .from(contentQueue)
    .leftJoin(socialAutomationRules, and(eq(socialAutomationRules.contentQueueId, contentQueue.id), eq(socialAutomationRules.tenantId, tenantId)))
    .where(and(eq(contentQueue.tenantId, tenantId), eq(contentQueue.agentKey, "ai_copywriter")))
    .orderBy(desc(contentQueue.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map(({ post, rule }) => ({
    id: post.id,
    platform: post.platform,
    title: post.title,
    body: post.body,
    status: post.status,
    createdAt: post.createdAt,
    postedAt: post.postedAt,
    mediaUrls: ((post.outputJson as { mediaUrls?: string[] } | null)?.mediaUrls ?? []).filter((u) => typeof u === "string"),
    trigger: rule ? { id: rule.id, keywords: rule.triggerKeywords, postId: rule.postId, postUrl: rule.postUrl, isActive: rule.isActive } : null,
  }));
}

/** Pending triggers (saved, not yet published) — shown as a to-do on the copywriter page. */
export async function countPendingStudioTriggers(tenantId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(socialAutomationRules)
    .where(and(eq(socialAutomationRules.tenantId, tenantId), isNull(socialAutomationRules.postId), sql`${socialAutomationRules.contentQueueId} is not null`));
  return row?.n ?? 0;
}
