import { verifyAndApplyBayanGoWebhook } from "@/lib/bayango-webhook";

/**
 * BayanGo delivery status webhook (AI suite Phase 4 URL). Same handler as /api/webhooks/bayango:
 * HMAC-SHA256 with BAYANGO_WEBHOOK_SECRET, 5-minute replay window; "delivered" schedules the
 * 2-hour review prompt.
 */
export async function POST(request: Request) {
  return verifyAndApplyBayanGoWebhook(request);
}
