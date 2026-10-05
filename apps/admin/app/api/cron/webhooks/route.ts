import { NextResponse } from "next/server";
import { runWebhooks } from "@/lib/webhook-sender";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Phase 15: fan out webhook events and send due deliveries (with retries). Every tick. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runWebhooks()) });
  } catch (error) {
    console.error("[cron webhooks]", error);
    return NextResponse.json({ ok: false, error: "Webhook run failed." }, { status: 500 });
  }
}
