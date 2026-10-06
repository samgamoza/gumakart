import { NextResponse } from "next/server";
import { listSyncingMarketplaceAccounts } from "@gumakart/db";
import { syncMarketplaceAccount } from "@/lib/marketplace-sync";
import { isCronAuthorized } from "@/lib/cron-auth";


/** Phase 13: Shopee/Lazada stock push + order import for every connected shop. Every 5 min. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const accounts = await listSyncingMarketplaceAccounts(50);
    let pushed = 0;
    let imported = 0;
    let failed = 0;
    for (const account of accounts) {
      const s = await syncMarketplaceAccount(account);
      pushed += s.pushed;
      imported += s.imported;
      if (s.error) failed += 1;
    }
    return NextResponse.json({ ok: true, accounts: accounts.length, pushed, imported, failed });
  } catch (error) {
    console.error("[cron marketplaces]", error);
    return NextResponse.json({ ok: false, error: "Marketplace sync failed." }, { status: 500 });
  }
}
