import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertSocialAccount, InboxError } from "@gumakart/db";
import { exchangeMetaCode, listMetaPages, sealToken, subscribeMetaPage } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

/**
 * Facebook Login returns here. Every Page the owner ticked in Meta's dialog is connected
 * (with its Instagram professional account, if linked) and subscribed to our webhook.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(`${url.origin}/channels?${q}`);
  try {
    const session = await requireTenantSession();
    const store = await cookies();
    const [state, tenantId] = (store.get("gk_meta_state")?.value ?? "").split(".");
    store.delete("gk_meta_state");
    if (!state || state !== url.searchParams.get("state") || tenantId !== session.tenantId) return back("meta=error&reason=state");
    if (url.searchParams.get("error")) return back("meta=cancelled");
    const code = url.searchParams.get("code");
    if (!code) return back("meta=error&reason=code");
    const userToken = await exchangeMetaCode(code, `${url.origin}/api/channels/meta/callback`);
    const pages = await listMetaPages(userToken);
    if (pages.length === 0) return back("meta=error&reason=nopages");
    let connected = 0;
    const taken: string[] = [];
    for (const page of pages) {
      const sealed = await sealToken(page.accessToken);
      try {
        await upsertSocialAccount({ tenantId: session.tenantId, platform: "messenger", externalId: page.id, name: page.name, pageId: page.id, accessTokenSealed: sealed });
        if (page.instagram) {
          await upsertSocialAccount({
            tenantId: session.tenantId,
            platform: "instagram",
            externalId: page.instagram.id,
            name: page.instagram.username ? `@${page.instagram.username}` : page.instagram.name ?? `${page.name} (Instagram)`,
            pageId: page.id,
            accessTokenSealed: sealed,
          });
        }
        await subscribeMetaPage(page.id, page.accessToken);
        connected += 1;
      } catch (error) {
        if (error instanceof InboxError && error.code === "TAKEN") taken.push(page.name);
        else throw error;
      }
    }
    await recordActivity(session, { action: "channels.meta_connected", entityType: "channel", entityId: "meta", summary: `Connected ${connected} Facebook Page(s) for Messenger/Instagram` });
    return back(`meta=connected&n=${connected}${taken.length ? `&taken=${encodeURIComponent(taken.join(", "))}` : ""}`);
  } catch (error) {
    console.error("[channels] meta callback", error);
    return back("meta=error");
  }
}
