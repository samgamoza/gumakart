import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelCampaign, queueCampaign, updateCampaign } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { campaignFail, segmentSchema } from "@/lib/campaign-api";
import { smsReady } from "@/lib/campaign-sender";

type Ctx = { params: Promise<{ campaignId: string }> };

/** Edit a draft. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    const { campaignId } = await params;
    z.string().uuid().parse(campaignId);
    const body = z.object({ name: z.string().max(120).optional(), segment: segmentSchema.optional(), body: z.string().max(300).optional() }).parse(await request.json());
    return NextResponse.json({ ok: true, campaign: await updateCampaign(session.tenantId, campaignId, body) });
  } catch (error) {
    return campaignFail(error, "update");
  }
}

/** Send: now (next run outside quiet hours) or at a time. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    const { campaignId } = await params;
    z.string().uuid().parse(campaignId);
    if (!smsReady()) return NextResponse.json({ ok: false, error: "SMS sending isn't connected yet. Your draft is saved — send it once texts are on." }, { status: 400 });
    const { sendAt } = z.object({ sendAt: z.string().datetime({ offset: true }).nullable().optional() }).parse(await request.json().catch(() => ({})));
    const campaign = await queueCampaign(session.tenantId, campaignId, sendAt ? new Date(sendAt) : null);
    await recordActivity(session, { action: "campaign.scheduled", entityType: "campaign", entityId: campaignId, summary: `SMS campaign "${campaign.name}" to ${campaign.recipients} buyer(s)` });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return campaignFail(error, "queue");
  }
}

/** Cancel (texts already sent stay sent). */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    const { campaignId } = await params;
    z.string().uuid().parse(campaignId);
    const campaign = await cancelCampaign(session.tenantId, campaignId);
    await recordActivity(session, { action: "campaign.cancelled", entityType: "campaign", entityId: campaignId, summary: `SMS campaign "${campaign.name}" cancelled` });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return campaignFail(error, "cancel");
  }
}
