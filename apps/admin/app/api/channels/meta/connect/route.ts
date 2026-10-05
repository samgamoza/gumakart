import { NextResponse } from "next/server";
import { ensureDemoSocialAccount, getTenantSettings } from "@gumakart/db";
import { metaLoginUrl, metaMode } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";
import { adminUrl } from "@/lib/utils";

const STATE_COOKIE = "gk_meta_state";

/**
 * Start connecting a Facebook Page (+ its Instagram account).
 *  - live: Facebook Login → /api/channels/meta/callback
 *  - demo (local/dev): connect a demo Page and demo Instagram right away
 *  - off: back to Channels with "Malapit na"
 */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const origin = new URL(request.url).origin || adminUrl;
    const mode = metaMode();
    if (mode === "off") return NextResponse.redirect(`${origin}/channels?meta=off`);
    if (mode === "demo") {
      const shop = await getTenantSettings(session.tenantId);
      await ensureDemoSocialAccount(session.tenantId, shop?.name ?? "Shop", "messenger");
      await ensureDemoSocialAccount(session.tenantId, shop?.name ?? "Shop", "instagram");
      return NextResponse.redirect(`${origin}/channels?meta=demo`);
    }
    const state = crypto.randomUUID().replace(/-/g, "");
    const res = NextResponse.redirect(metaLoginUrl({ redirectUri: `${origin}/api/channels/meta/callback`, state }));
    res.cookies.set(STATE_COOKIE, `${state}.${session.tenantId}`, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/channels/meta", maxAge: 600 });
    return res;
  } catch (error) {
    return channelFail(error, "meta connect");
  }
}
