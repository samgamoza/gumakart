import { NextResponse } from "next/server";
import { z } from "zod";
import { finishOnboarding, markOnboardingStep } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

const schema = z.object({ action: z.enum(["product_done", "completed", "skipped"]) });

/** Records onboarding progress: step 2 done, all done, or "I'll do this later". */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
    if (parsed.data.action === "product_done") await markOnboardingStep(session.tenantId, 2);
    else {
      if (parsed.data.action === "completed") await markOnboardingStep(session.tenantId, 4);
      await finishOnboarding(session.tenantId, parsed.data.action);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[onboarding/finish]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
