import { NextResponse } from "next/server";
import { listBroadcastEnabledTenants, paydayPeriod, withCronLock } from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { notifySeller } from "@/lib/social-automation";

/**
 * AI suite Phase 4: on the 14th and 29th (Manila), remind Pro Live / Enterprise Vibe sellers that
 * payday is tomorrow — the dashboard also shows a "Send a payday broadcast" banner that day.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const period = paydayPeriod();
  if (!period) return NextResponse.json({ ok: true, skipped: "not a payday-prompt day" });
  try {
    const result = await withCronLock(`payday-alerts:${period}`, async () => {
      const shops = await listBroadcastEnabledTenants();
      for (const tenantId of shops) {
        await notifySeller(tenantId, {
          title: "Payday bukas! 💸",
          body: "Send a payday broadcast to your suki — VIP and payday shoppers are ready to reorder.",
          url: "/campaigns/broadcasts?new=payday",
          tag: `payday-${period}`,
        });
      }
      return { shops: shops.length };
    }, 3600);
    if (!result) return NextResponse.json({ ok: true, skipped: "already sent" });
    return NextResponse.json({ ok: true, period, ...result });
  } catch (error) {
    console.error("[cron payday-alerts]", error);
    return NextResponse.json({ ok: false, error: "Payday alerts failed." }, { status: 500 });
  }
}
