import { NextResponse } from "next/server";
import { z } from "zod";
import { bridgeConfigFromEnv, defaultBroadcastDraft, polishBroadcast } from "@gumakart/ai";
import {
  createBroadcast,
  dismissPaydayAlert,
  getPaydayAlert,
  getRawAiUsageCounts,
  getSegmentCounts,
  getTenantSettings,
  listBroadcasts,
  listSocialAccounts,
  previewBroadcastAudience,
  recordAiUsage,
} from "@gumakart/db";
import { getAiSuiteTier } from "@gumakart/plans";
import { rateLimit } from "@gumakart/services";
import { assertCan, requireTenantSession } from "@/lib/api-auth";
import { assertBroadcastPlan, broadcastFail, broadcastSchema } from "@/lib/broadcast-api";

/** AI suite Phase 4.2: payday & restock broadcasts — list + segment counts + payday banner. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const [settings, broadcasts, segments, payday, accounts] = await Promise.all([
      getTenantSettings(session.tenantId),
      listBroadcasts(session.tenantId),
      getSegmentCounts(session.tenantId),
      getPaydayAlert(session.tenantId),
      listSocialAccounts(session.tenantId),
    ]);
    const tier = getAiSuiteTier(settings?.subscriptionPlan);
    return NextResponse.json({
      ok: true,
      entitled: tier.broadcastEnabled,
      tierName: tier.displayName,
      broadcasts,
      segments,
      payday,
      channels: [...new Set(accounts.filter((a) => a.status !== "disconnected").map((a) => a.platform))],
      drafts: { payday: defaultBroadcastDraft("payday"), restock: defaultBroadcastDraft("restock"), custom: defaultBroadcastDraft("custom") },
    });
  } catch (error) {
    return broadcastFail(error, "list");
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), broadcast: broadcastSchema }),
  z.object({ action: z.literal("preview"), channel: broadcastSchema.shape.channel, segmentTags: broadcastSchema.shape.segmentTags, waTemplateName: z.string().max(120).nullish() }),
  z.object({
    action: z.literal("polish"),
    draft: z.string().trim().min(5).max(1000),
    kind: broadcastSchema.shape.kind,
    channel: broadcastSchema.shape.channel,
    productTitle: z.string().max(160).nullish(),
  }),
  z.object({ action: z.literal("dismiss_payday") }),
]);

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = actionSchema.parse(await request.json());
    if (body.action === "dismiss_payday") {
      await dismissPaydayAlert(session.tenantId);
      return NextResponse.json({ ok: true });
    }
    assertCan(session, "marketing.manage");
    await assertBroadcastPlan(session.tenantId);
    if (body.action === "create") {
      const b = body.broadcast;
      const created = await createBroadcast(session.tenantId, { ...b, waTemplateName: b.waTemplateName || null }, session.displayName?.split(" ")[0] || "Seller");
      return NextResponse.json({ ok: true, broadcast: created }, { status: 201 });
    }
    if (body.action === "preview") {
      return NextResponse.json({ ok: true, preview: await previewBroadcastAudience(session.tenantId, body) });
    }
    // polish: one Qwen3 call (local GPU first, cloud fallback); 30 per shop per day.
    const limit = await rateLimit(`broadcast-polish:${session.tenantId}`, { limit: 30, windowSeconds: 86_400 });
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "That's enough AI polishing for today — edit the text by hand." }, { status: 429 });
    const settings = await getTenantSettings(session.tenantId);
    const usage = await getRawAiUsageCounts(session.tenantId).catch(() => null);
    const out = await polishBroadcast(
      { draft: body.draft, kind: body.kind, channel: body.channel, shopName: settings?.name ?? "the shop", productTitle: body.productTitle },
      { tenantId: session.tenantId, bridge: bridgeConfigFromEnv(), plan: getAiSuiteTier(settings?.subscriptionPlan).legacyFeaturePlan, tokensUsedThisMonth: usage?.tokensThisMonth }
    );
    if (out.tokens > 0) await recordAiUsage(session.tenantId, { tokensUsed: out.tokens });
    return NextResponse.json({ ok: true, text: out.text, servedBy: out.servedBy, guards: out.guards });
  } catch (error) {
    return broadcastFail(error, "post");
  }
}
