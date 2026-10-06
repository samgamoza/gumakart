import { NextResponse } from "next/server";
import { captureError } from "@/lib/errors";
import { runBilling } from "@/lib/billing-notices";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Phase 16: plan reminders (7/3/1 days), grace notice, downgrade after grace. Hourly. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runBilling()) });
  } catch (error) {
    await captureError("GET /api/cron/billing", error);
    console.error("[cron billing]", error);
    return NextResponse.json({ ok: false, error: "Billing run failed." }, { status: 500 });
  }
}
