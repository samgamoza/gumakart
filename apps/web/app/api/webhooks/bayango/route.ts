import { verifyAndApplyBayanGoWebhook } from "@/lib/bayango-webhook";

/** BayanGo Partner API webhook — see lib/bayango-webhook.ts. */
export async function POST(request: Request) {
  return verifyAndApplyBayanGoWebhook(request);
}
