import { NextResponse } from "next/server";
import { getSchemaStatus, isApplied } from "@gumakart/db";

export const dynamic = "force-dynamic";

/**
 * Phase 19 — is the database migrated far enough? Public, read-only, answers only booleans:
 *  - GET                → { upToDate } for this deployed code
 *  - GET ?when=<journal when> → { applied } — used by CI before deploying newer code
 *    (the live app shares the database, so it can answer for the code about to ship).
 */
export async function GET(request: Request) {
  const status = await getSchemaStatus();
  const raw = new URL(request.url).searchParams.get("when");
  const headers = { "Cache-Control": "no-store" };
  if (raw !== null) {
    const when = Number(raw);
    if (!/^\d{10,16}$/.test(raw) || !Number.isFinite(when)) return NextResponse.json({ ok: false, error: "when must be a journal timestamp" }, { status: 400, headers });
    return NextResponse.json({ ok: true, applied: isApplied(status, when) }, { headers });
  }
  return NextResponse.json({ ok: true, upToDate: status.upToDate, expected: status.expected.tag }, { status: status.upToDate ? 200 : 503, headers });
}
