import { NextResponse } from "next/server";
import { runWalletSettlement } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Hourly cron: release cleared earnings, auto-request payouts, process queued transfers. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWalletSettlement();
  return NextResponse.json({ ok: true, ...result });
}
