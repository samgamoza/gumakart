import { NextResponse } from "next/server";
import { z } from "zod";
import { getReferralSummary, saveReferralSettings, syncReferrals } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

/** Phase 32: Settings → Suki loyalty → Referrals (rules + last 30 days). */
export async function GET() {
  try {
    const session = await requireTenantSession();
    await syncReferrals({ tenantId: session.tenantId, limit: 100 }).catch((e) => console.error("[referrals] sync", e));
    return NextResponse.json({ ok: true, ...(await getReferralSummary(session.tenantId)) });
  } catch (error) {
    return fail(error);
  }
}

const schema = z.object({
  enabled: z.boolean().optional(),
  referrerReward: z.number().min(0).max(5000).optional(),
  friendReward: z.number().min(0).max(5000).optional(),
  minOrder: z.number().min(0).max(1_000_000).optional(),
  monthlyCap: z.number().int().min(1).max(100).optional(),
});

export async function PUT(request: Request) {
  try {
    const session = await requireTenantSession();
    const rules = await saveReferralSettings(session.tenantId, schema.parse(await request.json()));
    await recordActivity(session, {
      action: "loyalty.referrals",
      entityType: "settings",
      entityId: session.tenantId,
      summary: `Referrals ${rules.enabled ? "on" : "off"} · ₱${rules.referrerReward} + ₱${rules.friendReward} · min ₱${rules.minOrder} · ${rules.monthlyCap}/month`,
    });
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the amounts and try again." }, { status: 400 });
  console.error("[loyalty/referrals]", error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
