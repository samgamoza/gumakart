import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { runPrintairUpsells } from "@/lib/ai-suite-growth";
import { isCronAuthorized } from "@/lib/cron-auth";

/** AI suite Phase 5: queue branded-packaging mockups (priority 10, no credit) at shop milestones. Hourly. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await withCronLock("printair", () => runPrintairUpsells(), 600);
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron printair]", error);
    return NextResponse.json({ ok: false, error: "Printair run failed." }, { status: 500 });
  }
}
