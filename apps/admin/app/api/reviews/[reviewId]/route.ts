import { NextResponse } from "next/server";
import { z } from "zod";
import { replyToReview, reportReview, ReviewError, setReviewHidden } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), reply: z.string().max(600) }),
  z.object({ action: z.literal("hide"), reason: z.string().max(200) }),
  z.object({ action: z.literal("show") }),
  z.object({ action: z.literal("report"), reason: z.string().max(200) }),
]);

/** Phase 23: reply, hide (with a reason), show again, or report to Guma. The buyer's words never change. */
export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { reviewId } = await params;
    z.string().uuid().parse(reviewId);
    const body = schema.parse(await request.json());
    let summary = "";
    if (body.action === "reply") {
      await replyToReview(session.tenantId, reviewId, body.reply);
      summary = body.reply.trim() ? "Replied to a review" : "Removed a review reply";
    } else if (body.action === "hide") {
      await setReviewHidden(session.tenantId, reviewId, true, body.reason);
      summary = `Hid a review: ${body.reason.trim()}`;
    } else if (body.action === "show") {
      await setReviewHidden(session.tenantId, reviewId, false);
      summary = "Showed a review again";
    } else {
      await reportReview(session.tenantId, reviewId, body.reason);
      summary = `Reported a review to Guma: ${body.reason.trim()}`;
    }
    await recordActivity(session, { action: `review.${body.action}`, entityType: "review", entityId: reviewId, summary });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof ReviewError) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the details." }, { status: 400 });
    console.error("[reviews POST]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
