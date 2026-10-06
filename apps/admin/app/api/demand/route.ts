import { NextResponse } from "next/server";
import { getDemandSummary } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 22: buyers waiting for restocks, most-saved items, and pre-orders still to ship. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, ...(await getDemandSummary(session.tenantId)) });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[demand GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
