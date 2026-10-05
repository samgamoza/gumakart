import { NextResponse } from "next/server";
import { getRepeatCohorts, getSalesReport, getStockValue } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { parseReportRange } from "@/lib/report-range";

/** Phase 14: sales report for a range, repeat buyers and stock value. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const range = parseReportRange(new URL(request.url).searchParams);
    const [report, repeat, stock] = await Promise.all([
      getSalesReport(session.tenantId, range),
      getRepeatCohorts(session.tenantId, 6),
      getStockValue(session.tenantId),
    ]);
    return NextResponse.json({ ok: true, label: range.label, report, repeat, stock });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[reports]", error);
    return NextResponse.json({ ok: false, error: "Could not build the report." }, { status: 500 });
  }
}
