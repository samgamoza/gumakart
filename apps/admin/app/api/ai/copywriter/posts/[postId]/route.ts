import { NextResponse } from "next/server";
import { z } from "zod";
import { attachPublishedPost } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";
import { resolvePostReference } from "@/lib/social-automation";

type Ctx = { params: Promise<{ postId: string }> };
const schema = z.object({ postRef: z.string().trim().min(3).max(600) });

/** The seller published the post: paste its link (or id) to switch the comment-to-DM trigger on. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const { postId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    const { postRef } = schema.parse(await request.json());
    // Phase 3: pfbid share links and Instagram shortcodes are looked up on the connected accounts.
    const ref = await resolvePostReference(session.tenantId, postRef);
    if (!ref.ok) return NextResponse.json({ ok: false, error: ref.error }, { status: ref.status });
    const res = await attachPublishedPost(session.tenantId, postId, ref.postId, postRef.startsWith("http") ? postRef : null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.reason === "not_found" ? "Not found." : "Another trigger is already attached to that post." },
        { status: res.reason === "not_found" ? 404 : 409 }
      );
    }
    return NextResponse.json({ ok: true, platformPostId: ref.postId, platform: ref.platform, resolvedVia: ref.resolvedVia, notice: ref.notice });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Paste the post link." }, { status: 400 });
    console.error("[ai/copywriter/posts/:id]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
