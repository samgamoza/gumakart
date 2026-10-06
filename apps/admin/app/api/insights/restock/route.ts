import { NextResponse } from "next/server";
import { getRestockSuggestions } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 26: items that will run out within two weeks at the last 30 days' pace. No AI involved. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const items = await getRestockSuggestions(session.tenantId);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[insights/restock]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
