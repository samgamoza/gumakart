import { claimCampaignBatches, campaignTag, finishCampaignIfDone, getTenantSettings, isCampaignActive, recordCampaignSend, sendWithLog } from "@gumakart/db";
import { allowIntegrationMocks, campaignSms, createSemaphoreClient, isQuietHours, withOptOutFooter } from "@gumakart/services";
import { storefrontBaseUrl } from "@/lib/utils";

/**
 * Phase 14: sends due SMS campaigns in small batches (admin cron, every 5 minutes).
 *  - never 9 PM – 8 AM Manila (quiet hours): due campaigns simply wait;
 *  - each text carries the shop name, the campaign link (?ref=sms&utm_campaign=…) and the
 *    signed "Stop" link; opt-outs are re-checked per message by sendWithLog;
 *  - message_log key campaign:<campaign>:<phone> → a number never gets the same campaign twice.
 */

export function smsReady(): boolean {
  return Boolean(process.env.SEMAPHORE_API_KEY?.trim()) || allowIntegrationMocks();
}

const base = () => storefrontBaseUrl.replace(/\/$/, "");

export function campaignLink(shopSlug: string, campaignId: string): string {
  return `${base()}/${shopSlug}?ref=sms&utm_campaign=${campaignTag(campaignId)}`;
}

/** What one recipient receives (also used for the preview in the composer). */
export function renderCampaignText(input: { shopName: string; shopSlug: string; campaignId: string; body: string; buyerName?: string | null; phone: string }): string {
  return withOptOutFooter(
    campaignSms({ shopName: input.shopName, body: input.body, buyerName: input.buyerName, link: campaignLink(input.shopSlug, input.campaignId) }),
    input.phone,
    base()
  );
}

export interface CampaignRunResult {
  quietHours: boolean;
  campaigns: number;
  sent: number;
  failed: number;
  suppressed: number;
}

export async function runCampaigns(now = new Date()): Promise<CampaignRunResult> {
  const result: CampaignRunResult = { quietHours: isQuietHours(now), campaigns: 0, sent: 0, failed: 0, suppressed: 0 };
  if (result.quietHours || !smsReady()) return result;
  const batches = await claimCampaignBatches(now, 100, 10);
  const sms = createSemaphoreClient();
  const shops = new Map<string, { name: string; slug: string } | null>();
  for (const batch of batches) {
    result.campaigns += 1;
    if (!shops.has(batch.campaign.tenantId)) {
      const s = await getTenantSettings(batch.campaign.tenantId);
      shops.set(batch.campaign.tenantId, s ? { name: s.name, slug: s.slug } : null);
    }
    const shop = shops.get(batch.campaign.tenantId);
    for (const r of batch.recipients) {
      // A seller can cancel mid-way: stop at the next text.
      if (!(await isCampaignActive(batch.campaign.id))) break;
      if (!shop) {
        await recordCampaignSend(r.id, batch.campaign.id, "failed", "Shop not found");
        result.failed += 1;
        continue;
      }
      let text: string;
      try {
        text = renderCampaignText({ shopName: shop.name, shopSlug: shop.slug, campaignId: batch.campaign.id, body: batch.campaign.body, buyerName: r.name, phone: r.phone });
      } catch (error) {
        // No opt-out secret: marketing texts can't legally go out. Leave them queued.
        console.error("[campaigns] opt-out link unavailable", error);
        return result;
      }
      const sent = await sendWithLog(
        {
          tenantId: batch.campaign.tenantId,
          customerId: r.customerId,
          channel: "sms",
          recipient: r.phone,
          recipe: "campaign",
          entityId: `${batch.campaign.id}:${r.phone.replace(/\D/g, "").slice(-10)}`,
          body: text,
          provider: "semaphore",
          kind: "marketing",
        },
        () => sms.send({ to: r.phone, message: text })
      );
      const status = sent.status === "sent" || sent.status === "duplicate" ? "sent" : sent.status === "suppressed" ? "suppressed" : "failed";
      await recordCampaignSend(r.id, batch.campaign.id, status, sent.status === "failed" ? sent.error : sent.status === "suppressed" ? sent.reason : null);
      result[status] += 1;
    }
    await finishCampaignIfDone(batch.campaign.id, now);
  }
  return result;
}
