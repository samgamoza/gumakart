import { NextResponse } from "next/server";
import { getTenantSettings, mirrorCatalogAsListings, upsertMarketplaceAccount } from "@gumakart/db";
import { lazadaAuthUrl, marketplaceMode, shopeeAuthUrl } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/**
 * Connect a Shopee or Lazada shop.
 *  - live: the marketplace's own authorization page → .../callback
 *  - demo (local/dev): a demo shop whose listings mirror this catalog, already linked
 *  - off: back to Channels ("Malapit na")
 */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const session = await requireTenantSession();
    const { platform } = await params;
    if (platform !== "shopee" && platform !== "lazada") return NextResponse.json({ ok: false, error: "Unknown marketplace." }, { status: 404 });
    const origin = new URL(request.url).origin;
    const mode = marketplaceMode(platform);
    if (mode === "off") return NextResponse.redirect(`${origin}/channels?${platform}=off`);
    if (mode === "demo") {
      const shop = await getTenantSettings(session.tenantId);
      const id = await upsertMarketplaceAccount({
        tenantId: session.tenantId,
        platform,
        shopExternalId: `demo-${platform}-${session.tenantId.slice(0, 8)}`,
        name: `${shop?.name ?? "Shop"} (demo ${platform === "shopee" ? "Shopee" : "Lazada"})`,
        tokensSealed: null,
        status: "mock",
      });
      await mirrorCatalogAsListings(session.tenantId, id);
      return NextResponse.redirect(`${origin}/channels?${platform}=demo`);
    }
    const state = crypto.randomUUID().replace(/-/g, "");
    const redirect = `${origin}/api/channels/marketplaces/${platform}/callback`;
    const url = platform === "shopee" ? await shopeeAuthUrl(`${redirect}?state=${state}`) : lazadaAuthUrl(redirect, state);
    const res = NextResponse.redirect(url);
    res.cookies.set("gk_mkt_state", `${state}.${session.tenantId}`, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/channels/marketplaces", maxAge: 900 });
    return res;
  } catch (error) {
    return channelFail(error, "marketplace connect");
  }
}
