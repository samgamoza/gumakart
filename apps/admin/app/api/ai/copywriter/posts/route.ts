import { NextResponse } from "next/server";
import { countPendingStudioTriggers, listStudioPosts } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";

export async function GET() {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const [posts, pending] = await Promise.all([listStudioPosts(session.tenantId, 20), countPendingStudioTriggers(session.tenantId)]);
    return NextResponse.json({ ok: true, posts, pendingTriggers: pending });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[ai/copywriter/posts]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
