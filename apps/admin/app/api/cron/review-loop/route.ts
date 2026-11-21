import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { runReviewLoop } from "@/lib/ai-suite-growth";
import { isCronAuthorized } from "@/lib/cron-auth";

/** AI suite Phase 4: BayanGo review asks, 2 h after delivery (Messenger / WhatsApp), and expiry. Every 5 minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await withCronLock("review-loop", () => runReviewLoop(), 300);
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron review-loop]", error);
    return NextResponse.json({ ok: false, error: "Review loop failed." }, { status: 500 });
  }
}
