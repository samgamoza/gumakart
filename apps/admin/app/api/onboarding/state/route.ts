import { NextResponse } from "next/server";
import { getCheckoutLinkShopOptions, getOnboardingState } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { storefrontBaseUrl } from "@/lib/utils";

export async function GET() {
  try {
    const session = await requireTenantSession();
    const [state, options] = await Promise.all([
      getOnboardingState(session.tenantId),
      getCheckoutLinkShopOptions(session.tenantId),
    ]);
    if (!state) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    return NextResponse.json({ ok: true, state, pickupEnabled: options.pickupEnabled, linkBaseUrl: `${storefrontBaseUrl}/c/` });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[onboarding/state]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
