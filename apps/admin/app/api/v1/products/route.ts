import { NextResponse } from "next/server";
import { apiListProducts, clampLimit, decodeCursor } from "@gumakart/db";
import { apiError, enumParam, withApi } from "@/lib/public-api";

/** GET /api/v1/products — newest first, with variants. Filter: status (draft, active, archived). */
export async function GET(request: Request) {
  return withApi(request, "products:read", async (p) => {
    const url = new URL(request.url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return apiError(400, "invalid_request", "cursor is not valid. Use next_cursor from the previous page.");
    return NextResponse.json(
      await apiListProducts(p.tenantId, {
        limit: clampLimit(url.searchParams.get("limit")),
        cursor,
        status: enumParam(url, "status", ["draft", "active", "archived"] as const),
      })
    );
  });
}
