import { NextResponse } from "next/server";
import { withApi } from "@/lib/public-api";

/** GET /api/v1/shop — which shop this key belongs to and what it may do (any valid key). */
export async function GET(request: Request) {
  return withApi(request, null, async (p) =>
    NextResponse.json({
      data: {
        id: p.tenantId,
        slug: p.tenantSlug,
        name: p.tenantName,
        currency: "PHP",
        timezone: "Asia/Manila",
        key: { name: p.tokenName, scopes: p.scopes },
      },
    })
  );
}
