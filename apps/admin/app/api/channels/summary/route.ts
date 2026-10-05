import { NextResponse } from "next/server";
import { getTenantSettings, salesByChannel } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail, shopShareUrl } from "@/lib/channels";

/** Sales by channel (last 30 days) and the shop link tagged per channel. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days") ?? 30) || 30, 1), 365);
    const [rows, shop] = await Promise.all([salesByChannel(session.tenantId, days), getTenantSettings(session.tenantId)]);
    const slug = shop?.slug ?? "";
    return NextResponse.json({
      ok: true,
      days,
      channels: rows,
      shareLinks: {
        facebook: shopShareUrl(slug, "facebook"),
        instagram: shopShareUrl(slug, "instagram"),
        tiktok: shopShareUrl(slug, "tiktok"),
        messenger: shopShareUrl(slug, "messenger"),
      },
    });
  } catch (error) {
    return channelFail(error, "channel summary");
  }
}
