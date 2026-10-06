import { NextResponse } from "next/server";
import { runWebhooks } from "@/lib/webhook-sender";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Phase 15: fan out webhook events and send due deliveries (with retries). Every tick. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runWebhooks()) });
  } catch (error) {
    console.error("[cron webhooks]", error);
    return NextResponse.json({ ok: false, error: "Webhook run failed." }, { status: 500 });
  }
}
