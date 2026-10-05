import { NextResponse } from "next/server";
import { z } from "zod";
import { createCampaign, listCampaigns } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { campaignFail, segmentSchema } from "@/lib/campaign-api";
import { smsReady } from "@/lib/campaign-sender";

export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, campaigns: await listCampaigns(session.tenantId), smsReady: smsReady(), smsLive: Boolean(process.env.SEMAPHORE_API_KEY?.trim()) });
  } catch (error) {
    return campaignFail(error, "list");
  }
}

/** New draft. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = z.object({ name: z.string().trim().min(1).max(120), segment: segmentSchema, body: z.string().max(300) }).parse(await request.json());
    const campaign = await createCampaign({ tenantId: session.tenantId, name: body.name, segment: body.segment, body: body.body, createdByName: session.displayName?.split(" ")[0] || "Seller" });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return campaignFail(error, "create");
  }
}
