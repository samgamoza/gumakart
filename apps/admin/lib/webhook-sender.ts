import {
  claimDueDeliveries,
  fanOutWebhookEvents,
  pruneWebhookEvents,
  recordDeliveryResult,
  validateWebhookUrl,
  WEBHOOK_TIMEOUT_MS,
  type DeliveryOutcome,
  type DueDelivery,
} from "@gumakart/db";
import { openToken, sendWebhook } from "@gumakart/services";

/** Dev and local only: http://localhost receivers, for testing. Production needs public HTTPS. */
export function allowLocalWebhooks(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Sends one claimed delivery and records the attempt. */
export async function sendDelivery(d: DueDelivery): Promise<{ status: "succeeded" | "retry" | "failed"; outcome: DeliveryOutcome }> {
  const check = validateWebhookUrl(d.url, { allowLocal: allowLocalWebhooks() });
  const secret = await openToken(d.secretSealed);
  let outcome: DeliveryOutcome;
  if (!check.ok) outcome = { ok: false, statusCode: null, error: check.error, ms: 0 };
  else if (!secret) outcome = { ok: false, statusCode: null, error: "The signing secret can't be read. Rotate it on the webhook.", ms: 0 };
  else {
    outcome = await sendWebhook({
      url: check.url,
      secret,
      body: d.body,
      event: d.event,
      eventId: d.eventId,
      deliveryId: d.id,
      attempt: d.attempts + 1,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
    });
  }
  return { status: await recordDeliveryResult(d, outcome), outcome };
}

/** Cron: fan out new events, send what's due (10 at a time), prune events older than 30 days. */
export async function runWebhooks(): Promise<{ events: number; queued: number; sent: number; retrying: number; failed: number; pruned: number }> {
  let events = 0;
  let queued = 0;
  for (let i = 0; i < 5; i++) {
    const r = await fanOutWebhookEvents({ limit: 200 });
    events += r.events;
    queued += r.deliveries;
    if (r.events < 200) break;
  }
  const due = await claimDueDeliveries({ limit: 100 });
  const tally = { sent: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < due.length; i += 10) {
    const results = await Promise.all(due.slice(i, i + 10).map((d) => sendDelivery(d)));
    for (const r of results) {
      if (r.status === "succeeded") tally.sent += 1;
      else if (r.status === "retry") tally.retrying += 1;
      else tally.failed += 1;
    }
  }
  const pruned = await pruneWebhookEvents();
  return { events, queued, ...tally, pruned };
}
