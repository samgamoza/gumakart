import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { runBroadcasts } from "@/lib/ai-suite-growth";
import { isCronAuthorized } from "@/lib/cron-auth";

/** AI suite Phase 4: send due payday / restock broadcasts (≤ 10 msg/s, Meta-window aware). Odd minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await withCronLock("broadcasts", () => runBroadcasts({ deadlineMs: 50_000 }), 120);
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron broadcasts]", error);
    return NextResponse.json({ ok: false, error: "Broadcast run failed." }, { status: 500 });
  }
}
