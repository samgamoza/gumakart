import { NextResponse } from "next/server";
import { reportCsv, type ReportExport } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { parseReportRange } from "@/lib/report-range";

const KINDS: ReportExport[] = ["orders", "products", "customers", "daily"];

/** CSV for Excel/Sheets: ?type=orders|products|customers|daily plus the same range params. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const params = new URL(request.url).searchParams;
    const type = params.get("type") as ReportExport;
    if (!KINDS.includes(type)) return NextResponse.json({ ok: false, error: "Unknown export." }, { status: 400 });
    const range = parseReportRange(params);
    const csv = await reportCsv(session.tenantId, type, range);
    await recordActivity(session, { action: "reports.exported", entityType: "report", entityId: type, summary: `Exported ${type} (${range.label})` });
    const day = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${type}-${day(range.from)}-to-${day(new Date(range.to.getTime() - 1))}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[reports export]", error);
    return NextResponse.json({ ok: false, error: "Export failed. Please try again." }, { status: 500 });
  }
}
