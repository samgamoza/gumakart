import { NextResponse } from "next/server";
import { syncLoyaltyPoints } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";

/** Phase 27: Suki points for newly paid orders, and take-backs for refunds/cancellations. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncLoyaltyPoints({ limit: 1000 });
  return NextResponse.json({ ok: true, ...result });
}
