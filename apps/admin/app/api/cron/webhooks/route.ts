import { NextResponse } from "next/server";
import { withCronLock } from "@gumakart/db";
import { runWebhooks } from "@/lib/webhook-sender";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Phase 15: fan out webhook events and send due deliveries (with retries). Every tick. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await withCronLock("webhooks", () => runWebhooks());
    if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron webhooks]", error);
    return NextResponse.json({ ok: false, error: "Webhook run failed." }, { status: 500 });
  }
}
