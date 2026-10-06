import { NextResponse } from "next/server";
import { z } from "zod";
import { getLoyaltySummary, saveLoyaltySettings, syncLoyaltyPoints } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

/** Phase 27: Settings → Suki loyalty (rules + summary). */
export async function GET() {
  try {
    const session = await requireTenantSession();
    await syncLoyaltyPoints({ tenantId: session.tenantId, limit: 200 }).catch((e) => console.error("[loyalty] sync", e));
    return NextResponse.json({ ok: true, ...(await getLoyaltySummary(session.tenantId)) });
  } catch (error) {
    return fail(error);
  }
}

const schema = z.object({
  enabled: z.boolean().optional(),
  pesoPerPoint: z.number().int().min(20).max(1000).optional(),
  pointValue: z.number().min(0.1).max(5).optional(),
  minRedeem: z.number().int().min(1).max(100_000).optional(),
  tiers: z
    .object({ silver: z.number().min(100).optional(), gold: z.number().min(100).optional(), platinum: z.number().min(100).optional() })
    .optional(),
});

export async function PUT(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    const t = body.tiers;
    if (t?.silver != null && t?.gold != null && t?.platinum != null && !(t.silver < t.gold && t.gold < t.platinum)) {
      return NextResponse.json({ ok: false, error: "Tier amounts must go up: Silver < Gold < Platinum." }, { status: 400 });
    }
    const rules = await saveLoyaltySettings(session.tenantId, body);
    await recordActivity(session, {
      action: "loyalty.settings",
      entityType: "settings",
      entityId: session.tenantId,
      summary: `Suki loyalty ${rules.enabled ? "on" : "off"} · ₱${rules.pesoPerPoint} = 1 pt · 1 pt = ₱${rules.pointValue}`,
    });
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the numbers and try again." }, { status: 400 });
  console.error("[loyalty]", error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
