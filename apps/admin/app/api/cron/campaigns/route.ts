import { NextResponse } from "next/server";
import { runCampaigns } from "@/lib/campaign-sender";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Phase 14: send due SMS campaigns (batches, outside quiet hours). Every 5 minutes. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runCampaigns()) });
  } catch (error) {
    console.error("[cron campaigns]", error);
    return NextResponse.json({ ok: false, error: "Campaign run failed." }, { status: 500 });
  }
}
