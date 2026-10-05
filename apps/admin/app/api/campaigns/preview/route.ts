import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantSettings, previewSegment } from "@gumakart/db";
import { smsSegments } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { campaignFail, segmentSchema } from "@/lib/campaign-api";
import { renderCampaignText } from "@/lib/campaign-sender";

/** How many people a segment reaches, and what one text will look like. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = z.object({ segment: segmentSchema, body: z.string().max(300).default("") }).parse(await request.json());
    const [reach, shop] = await Promise.all([previewSegment(session.tenantId, body.segment), getTenantSettings(session.tenantId)]);
    let sample: string | null = null;
    try {
      sample = renderCampaignText({ shopName: shop?.name ?? "Shop", shopSlug: shop?.slug ?? "", campaignId: "00000000-0000-0000-0000-000000000000", body: body.body || "…", buyerName: reach.sample[0] ?? "Ana", phone: "09170000000" });
    } catch {
      sample = null;
    }
    return NextResponse.json({ ok: true, ...reach, preview: sample, segments: sample ? smsSegments(sample) : null });
  } catch (error) {
    return campaignFail(error, "preview");
  }
}
