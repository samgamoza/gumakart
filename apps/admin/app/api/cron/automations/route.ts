import { NextResponse } from "next/server";
import { runTimedAutomations } from "@/lib/automations";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Timed SMS recipes (unfinished checkout, unpaid reminder). Every 5 minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTimedAutomations();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron automations]", error);
    return NextResponse.json({ ok: false, error: "Automation run failed." }, { status: 500 });
  }
}
