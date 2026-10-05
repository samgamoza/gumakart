import { NextResponse } from "next/server";
import { apiListCustomers, clampLimit, decodeCursor } from "@gumakart/db";
import { apiError, withApi } from "@/lib/public-api";

/** GET /api/v1/customers — newest first. Filter: phone (matched on the last 10 digits). */
export async function GET(request: Request) {
  return withApi(request, "customers:read", async (p) => {
    const url = new URL(request.url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return apiError(400, "invalid_request", "cursor is not valid. Use next_cursor from the previous page.");
    return NextResponse.json(
      await apiListCustomers(p.tenantId, { limit: clampLimit(url.searchParams.get("limit")), cursor, phone: url.searchParams.get("phone") })
    );
  });
}
