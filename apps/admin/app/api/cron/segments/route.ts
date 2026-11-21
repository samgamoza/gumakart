import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { runSegmentRefresh } from "@/lib/ai-suite-growth";
import { isCronAuthorized } from "@/lib/cron-auth";

/** AI suite Phase 4: nightly buyer segments per shop (refresh_buyer_crm_segments). */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await withCronLock("segments", () => runSegmentRefresh({ deadlineMs: 240_000 }), 900);
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron segments]", error);
    return NextResponse.json({ ok: false, error: "Segment refresh failed." }, { status: 500 });
  }
}
