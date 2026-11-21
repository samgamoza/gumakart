import { NextResponse } from "next/server";
import { z } from "zod";
import { COPY_PLATFORMS } from "@gumakart/ai";
import { getProductForTenant, getTenantSettings, saveStudioPost } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { assertMediaOwned, canAttachTrigger, StudioInputError } from "@/lib/marketing-studio";

const schema = z.object({
  platform: z.enum(COPY_PLATFORMS),
  productId: z.string().uuid().optional(),
  link: z.string().url().max(400).optional(),
  hook: z.string().trim().max(200).optional(),
  caption: z.string().trim().min(10).max(2200),
  hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  mediaUrls: z.array(z.string().max(2000)).max(10).default([]),
  attachTrigger: z.boolean().default(true),
  triggerKeywords: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
  publicReplies: z.array(z.string().trim().min(2).max(300)).max(5).optional(),
  copy: z.record(z.unknown()).default({}),
});

/** "Save to Post & Attach Comment-to-DM Trigger" (Phase 2.3). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const body = schema.parse(await request.json());
    assertMediaOwned(session.tenantId, body.mediaUrls);
    if (body.productId && !(await getProductForTenant(session.tenantId, body.productId))) {
      return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
    }
    const settings = await getTenantSettings(session.tenantId);
    const attach = body.attachTrigger && canAttachTrigger(settings?.subscriptionPlan);
    const text = body.hook && !body.caption.startsWith(body.hook) ? `${body.hook}\n\n${body.caption}` : body.caption;
    const fullBody = body.hashtags.length ? `${text}\n\n${body.hashtags.join(" ")}` : text;
    const saved = await saveStudioPost({
      tenantId: session.tenantId,
      platform: body.platform,
      title: (body.hook ?? body.caption).slice(0, 120),
      body: fullBody,
      mediaUrls: body.mediaUrls,
      productId: body.productId ?? null,
      link: body.link ?? null,
      copy: body.copy,
      attachTrigger: attach,
      triggerKeywords: body.triggerKeywords,
      publicReplyTemplates: body.publicReplies,
    });
    return NextResponse.json(
      {
        ok: true,
        postId: saved.postId,
        triggerAttached: !!saved.ruleId,
        notice: body.attachTrigger && !attach ? "Saved. Comment-to-DM triggers start on the Starter plan." : undefined,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof StudioInputError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.issues[0]?.message ?? "Check the post." }, { status: 400 });
    console.error("[ai/copywriter/save]", error);
    return NextResponse.json({ ok: false, error: "Couldn't save the post." }, { status: 500 });
  }
}
