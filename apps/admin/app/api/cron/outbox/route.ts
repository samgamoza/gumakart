import { NextResponse } from "next/server";
import { outboxBacklog, relayOutbox, withCronLock } from "@gumakart/db";
import { inngest, isInngestConfigured } from "@gumakart/events";
import { handleOrderEvent } from "@/lib/automations";
import { isCronAuthorized } from "@/lib/cron-auth";


/**
 * Outbox relay (every minute). Order events are written inside the same
 * transaction as the order change; this hands them to Inngest with
 * id = idempotency key, so a row sent twice is still delivered once.
 * Failures back off 1m → 5m → 30m → 2h and stop after 10 attempts.
 *
 * Phase 4: every event also runs the built-in SMS recipes (`handleOrderEvent`)
 * before it is marked published. A throw there leaves the row for a retry;
 * message_log keys make the retry safe. Without Inngest the rows stay as the
 * order event log.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const live = isInngestConfigured();
  const sms: Array<{ recipe: string; status: string }> = [];
  // Security G3: one relay at a time, so an event is never handled by two overlapping runs.
  const result = await withCronLock("outbox", () =>
    relayOutbox(
      async (row) => {
        const outcome = await handleOrderEvent(row);
        if (outcome) sms.push(outcome);
        if (!live) return;
        await inngest.send({
          id: row.idempotencyKey,
          name: row.name,
          data: { ...row.data, idempotencyKey: row.idempotencyKey },
        });
      },
      { limit: 100 }
    )
  );
  if (!result) return NextResponse.json({ ok: true, skipped: "another run is still going" });
  const backlog = await outboxBacklog();
  if (backlog.stuck > 0) {
    console.error("[outbox] events gave up after max attempts", backlog);
  }
  return NextResponse.json({ ok: true, inngest: live, ...result, backlog, sms });
}
