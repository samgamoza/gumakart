import { NextResponse } from "next/server";
import { z } from "zod";
import { markOnboardingStep, OnboardingError, saveOnboardingPayments } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

const schema = z.object({
  gcashNumber: z.string().max(20).optional(),
  gcashName: z.string().max(80).optional(),
  mayaNumber: z.string().max(20).optional(),
  mayaName: z.string().max(80).optional(),
  codEnabled: z.boolean(),
});

/** Onboarding step 3 — how you get paid. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Check your payment details." }, { status: 400 });
    }
    await saveOnboardingPayments(session.tenantId, parsed.data);
    await markOnboardingStep(session.tenantId, 3);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof OnboardingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("[onboarding/payments]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
