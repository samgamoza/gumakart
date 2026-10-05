import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketplaceAccount } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";
import { syncMarketplaceAccount } from "@/lib/marketplace-sync";

/** "Sync now": refresh listings, push stock, import orders. */
export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const account = await getMarketplaceAccount(session.tenantId, accountId);
    if (!account || account.status === "disconnected") return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    const summary = await syncMarketplaceAccount(account, { refreshListings: true });
    return NextResponse.json({ ok: !summary.error, summary, error: summary.error });
  } catch (error) {
    return channelFail(error, "marketplace sync");
  }
}
