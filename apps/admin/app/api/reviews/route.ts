import { NextResponse } from "next/server";
import { getTenantReviewStats, listTenantReviews, type ReviewFilter } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

const FILTERS: ReviewFilter[] = ["all", "needs_reply", "low", "hidden", "reported"];

/** Phase 23: the shop's verified reviews, newest first, with totals. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const f = new URL(request.url).searchParams.get("filter") as ReviewFilter | null;
    const filter = f && FILTERS.includes(f) ? f : "all";
    const [reviews, stats] = await Promise.all([listTenantReviews(session.tenantId, filter), getTenantReviewStats(session.tenantId)]);
    return NextResponse.json({ ok: true, reviews, stats });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[reviews GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
