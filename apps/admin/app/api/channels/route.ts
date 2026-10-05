import { NextResponse } from "next/server";
import { listImportedOrders, listMarketplaceAccounts, listSocialAccounts } from "@gumakart/db";
import { marketplaceMode, metaMode } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/** Everything the Channels page shows: connected accounts and which integrations are live. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [social, marketplaces, imported] = await Promise.all([
      listSocialAccounts(session.tenantId),
      listMarketplaceAccounts(session.tenantId),
      listImportedOrders(session.tenantId, 10),
    ]);
    return NextResponse.json({
      ok: true,
      modes: { meta: metaMode(), shopee: marketplaceMode("shopee"), lazada: marketplaceMode("lazada"), email: process.env.RESEND_API_KEY?.trim() ? "live" : "off" },
      social,
      marketplaces,
      imported: imported.map((o) => ({ ...o, total: Number(o.total) })),
    });
  } catch (error) {
    return channelFail(error, "channels");
  }
}
