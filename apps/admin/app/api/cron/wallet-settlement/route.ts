import { NextResponse } from "next/server";
import { runWalletSettlement, withCronLock } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Hourly cron: release cleared earnings, auto-request payouts, process queued transfers. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Security G3: one run at a time (overlapping settlements could double-release).
  const result = await withCronLock("wallet-settlement", () => runWalletSettlement());
  if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
  return NextResponse.json({ ok: true, ...result });
}
