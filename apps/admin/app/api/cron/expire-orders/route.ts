import { NextResponse } from "next/server";
import { DEFAULT_UNPAID_EXPIRY_HOURS, expireUnpaidOrders, withCronLock } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";


function expiryHours(): number {
  const raw = Number(process.env.ORDER_UNPAID_EXPIRY_HOURS);
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_UNPAID_EXPIRY_HOURS;
}

/**
 * Cancels orders still unpaid after each shop's window (Settings → Checkout,
 * `checkout.unpaidExpiryHours`, 1–72) and puts their stock back. Shops without
 * a setting use ORDER_UNPAID_EXPIRY_HOURS (default 24). Orders where the buyer
 * already sent payment details wait for the seller.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await withCronLock("expire-orders", () => expireUnpaidOrders({ defaultHours: expiryHours() }));
  if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
  return NextResponse.json({ ok: true, ...result });
}
