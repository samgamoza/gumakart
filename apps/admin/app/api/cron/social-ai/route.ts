import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runCartRecovery, sweepUnansweredChats } from "@/lib/social-automation";

/**
 * AI suite Phase 3, every 2 minutes:
 *  1. abandoned-cart & ghost-buyer recovery — one nudge per chat + link, 30 minutes after an unpaid
 *     checkout link, only while Meta's 24-hour window is still open (30-minute margin);
 *  2. safety net for the AI closer — chats whose last buyer message is still unanswered.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await withCronLock(
      "social-ai",
      async () => {
        const recovery = await runCartRecovery({ deadlineMs: 35_000 });
        const sweep = await sweepUnansweredChats({ deadlineMs: 30_000 });
        return { ...recovery, unanswered: sweep.checked, answered: sweep.sent };
      },
      300
    );
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron social-ai]", error);
    return NextResponse.json({ ok: false, error: "Social AI run failed." }, { status: 500 });
  }
}
