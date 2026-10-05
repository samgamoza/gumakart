import { NextResponse } from "next/server";
import { getBillingOverview } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

/** Phase 16: plan status (renews / ends / grace) and payment history with receipt numbers. */
export async function GET() {
  try {
    const session = await requireTenantSession({ allowSuspended: true });
    return NextResponse.json({ ok: true, ...(await getBillingOverview(session.tenantId)), billingEnabled: process.env.NEXT_PUBLIC_PLAN_BILLING_ENABLED === "true" });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[billing overview]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
