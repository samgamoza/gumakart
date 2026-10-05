import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDemoSocialAccount, getTenantSettings, recordSocialMessage } from "@gumakart/db";
import { metaMode } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

const DEMO_BUYERS = [
  { id: "demo-buyer-ana", name: "Ana Reyes" },
  { id: "demo-buyer-jun", name: "Jun Dela Cruz" },
  { id: "demo-buyer-mae", name: "Mae Santos" },
];

/**
 * Local/dev only: pretend a buyer messaged the shop's (demo) Page, so the inbox can be tried
 * before Meta approves the app. Refused when Meta is live or in production without mocks.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    if (metaMode() !== "demo") return NextResponse.json({ ok: false, error: "Demo chats are only for test setups." }, { status: 403 });
    const body = z
      .object({ platform: z.enum(["messenger", "instagram"]).default("messenger"), text: z.string().trim().min(1).max(500), buyer: z.number().int().min(0).max(2).default(0) })
      .parse(await request.json());
    const shop = await getTenantSettings(session.tenantId);
    const account = await ensureDemoSocialAccount(session.tenantId, shop?.name ?? "Shop", body.platform);
    const buyer = DEMO_BUYERS[body.buyer]!;
    const result = await recordSocialMessage({
      account: { id: account.id, tenantId: session.tenantId, platform: body.platform },
      userId: `${buyer.id}-${body.platform}`,
      messageId: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: body.text,
      kind: "text",
      at: new Date(),
      buyerName: buyer.name,
    });
    return NextResponse.json({ ok: true, threadId: result.threadId });
  } catch (error) {
    return channelFail(error, "inbox simulate");
  }
}
