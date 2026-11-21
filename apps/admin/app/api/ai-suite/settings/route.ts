import { NextResponse } from "next/server";
import { z } from "zod";
import { getAiSuiteSettings, saveAiSuiteSettings } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";

/** AI suite Phase 4: review-loop switch, thank-you voucher, approved WhatsApp template names. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    return NextResponse.json({ ok: true, settings: await getAiSuiteSettings(session.tenantId) });
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  reviewLoopEnabled: z.boolean().optional(),
  reviewVoucherAmount: z.number().min(0).max(5000).optional(),
  reviewVoucherDays: z.number().int().min(1).max(365).optional(),
  waReviewTemplate: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{0,120}$/, "WhatsApp template names are lowercase letters, numbers and _")
    .nullish(),
  waTemplateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).optional(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const body = patchSchema.parse(await request.json());
    const settings = await saveAiSuiteSettings(session.tenantId, { ...body, waReviewTemplate: body.waReviewTemplate || null });
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  console.error("[ai-suite settings]", error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
