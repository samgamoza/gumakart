import { listAlertsToSend, markAlertNotified, sendWithLog } from "@gumakart/db";
import {
  allowIntegrationMocks,
  backInStockSms,
  createSemaphoreClient,
  isEmailConfigured,
  sendTransactionalEmail,
} from "@gumakart/services";

/**
 * Phase 22: tell buyers their sold-out item is back (they asked, so it's a service message, not
 * marketing). Oldest request first; a channel that isn't set up yet leaves the request waiting —
 * the seller still sees who's waiting on the Stock page and can message them by hand.
 */
export async function sendBackInStockAlerts(webBase: string, limit = 100): Promise<{ considered: number; sent: number; waiting: number }> {
  const smsReady = Boolean(process.env.SEMAPHORE_API_KEY?.trim()) || allowIntegrationMocks();
  const emailReady = isEmailConfigured() || allowIntegrationMocks();
  const out = { considered: 0, sent: 0, waiting: 0 };
  for (const a of await listAlertsToSend(limit)) {
    out.considered += 1;
    const url = `${webBase}/${a.tenantSlug}/products/${a.productSlug}`;
    if (a.phone && smsReady) {
      const body = backInStockSms({ shopName: a.shopName, productTitle: a.productTitle, variantTitle: a.variantTitle, url });
      const sms = createSemaphoreClient();
      const r = await sendWithLog(
        { tenantId: a.tenantId, channel: "sms", recipient: a.phone, recipe: "back_in_stock", entityId: a.id, body, provider: "semaphore", kind: "transactional" },
        () => sms.send({ to: a.phone!, message: body })
      );
      // One try per request: sent, opted out, or failed (shown in the shop's SMS log) all close it.
      await markAlertNotified(a.id);
      if (r.status === "sent") out.sent += 1;
    } else if (!a.phone && a.email && emailReady) {
      const what = a.variantTitle ? `${a.productTitle} (${a.variantTitle})` : a.productTitle;
      const text = `Good news — ${what} is back in stock at ${a.shopName}.\n\nOrder here while it lasts: ${url}\n\nYou're getting this because you asked to be told when it's back.`;
      const r = await sendWithLog(
        { tenantId: a.tenantId, channel: "email", recipient: a.email, recipe: "back_in_stock", entityId: a.id, body: text, provider: "resend", kind: "transactional" },
        async () => {
          const res = await sendTransactionalEmail({ to: a.email!, subject: `Back in stock: ${what}`, text });
          return { success: res.sent, messageId: res.id, mock: res.mock, error: res.error };
        }
      );
      await markAlertNotified(a.id);
      if (r.status === "sent") out.sent += 1;
    } else {
      out.waiting += 1;
    }
  }
  return out;
}
