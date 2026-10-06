import { NextResponse } from "next/server";
import { syncLoyaltyPoints, syncReferrals } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";

/** Phase 27: Suki points for newly paid orders, take-backs for refunds/cancellations; Phase 32: referral rewards. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const points = await syncLoyaltyPoints({ limit: 1000 });
  // Phase 32: referral rewards ride on the same tick.
  const refs = await syncReferrals({ limit: 500 });
  return NextResponse.json({ ok: true, ...points, ...refs });
}
