import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getMarketplaceAccount, MarketplaceSyncError, upsertMarketplaceAccount } from "@gumakart/db";
import { lazadaExchangeCode, sealToken, shopeeExchangeCode } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { syncMarketplaceAccount } from "@/lib/marketplace-sync";

/** The marketplace sends the owner back here after they authorize Guma Kart. */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const url = new URL(request.url);
  const { platform } = await params;
  const back = (q: string) => NextResponse.redirect(`${url.origin}/channels?${q}`);
  if (platform !== "shopee" && platform !== "lazada") return back("mkt=error");
  try {
    const session = await requireTenantSession();
    const store = await cookies();
    const [state, tenantId] = (store.get("gk_mkt_state")?.value ?? "").split(".");
    store.delete("gk_mkt_state");
    if (!state || state !== url.searchParams.get("state") || tenantId !== session.tenantId) return back(`${platform}=error&reason=state`);
    const code = url.searchParams.get("code");
    if (!code) return back(`${platform}=cancelled`);
    let shopId: string;
    let name: string;
    let tokens: { accessToken: string; refreshToken: string; expiresAt: Date };
    if (platform === "shopee") {
      shopId = url.searchParams.get("shop_id") ?? "";
      if (!shopId) return back("shopee=error&reason=shop");
      tokens = await shopeeExchangeCode(code, shopId);
      name = `Shopee shop ${shopId}`;
    } else {
      const t = await lazadaExchangeCode(code);
      shopId = t.sellerId;
      name = t.name ? `Lazada · ${t.name}` : `Lazada seller ${t.sellerId}`;
      tokens = t;
    }
    const sealed = await sealToken(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt.toISOString() }));
    const id = await upsertMarketplaceAccount({ tenantId: session.tenantId, platform, shopExternalId: shopId, name, tokensSealed: sealed, tokenExpiresAt: tokens.expiresAt });
    await recordActivity(session, { action: "channels.marketplace_connected", entityType: "channel", entityId: id, summary: `Connected ${name}` });
    // First sync: fetch listings and auto-link by SKU (no stock is pushed until a listing is linked).
    const account = await getMarketplaceAccount(session.tenantId, id);
    if (account) await syncMarketplaceAccount(account, { refreshListings: true });
    return back(`${platform}=connected`);
  } catch (error) {
    if (error instanceof MarketplaceSyncError) return back(`${platform}=taken`);
    console.error("[channels] marketplace callback", error);
    return back(`${platform}=error`);
  }
}
