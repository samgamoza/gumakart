import { NextResponse } from "next/server";
import { getSellerToday } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { storefrontBaseUrl } from "@/lib/utils";

export async function GET() {
  try {
    const session = await requireTenantSession({ allowSuspended: true });
    const today = await getSellerToday(session.tenantId, { emailVerified: Boolean(session.emailVerified) });
    if (!today) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      today,
      urls: { linkBase: `${storefrontBaseUrl}/c/`, storefront: `${storefrontBaseUrl}/${today.shop.slug}` },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[dashboard/today]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
