import { NextResponse } from "next/server";
import { getRevenueForecast } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 33 (H10): next-30-days sales range from the shop's last 12 weeks. Plain arithmetic, no AI. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, forecast: await getRevenueForecast(session.tenantId) });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[insights/forecast]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
