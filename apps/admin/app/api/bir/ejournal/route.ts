import { NextResponse } from "next/server";
import { z } from "zod";
import { posEJournalCsv } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** E-journal CSV of POS receipts for ?from=YYYY-MM-DD&to=YYYY-MM-DD (Manila days, ≤ 92 days). */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const url = new URL(request.url);
    const from = day.parse(url.searchParams.get("from"));
    const to = day.parse(url.searchParams.get("to"));
    // Manila midnight = 16:00 UTC the day before.
    const start = new Date(`${from}T00:00:00+08:00`);
    const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86_400_000);
    if (end <= start) return NextResponse.json({ ok: false, error: "The end date is before the start." }, { status: 400 });
    const csv = await posEJournalCsv(session.tenantId, new Date(start.getTime() - 1), end);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ejournal-${from}-to-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return afterSaleFail(error, "ejournal");
  }
}
