import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdvisorFacts } from "@gumakart/db";
import type { AdvisorOutput } from "@gumakart/ai";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAssistForTenant } from "@/lib/ai-assist";

const schema = z.object({ question: z.string().trim().min(3, "Type a question.").max(500) });

/** Phase 26: "Ask Guma" — answers from the shop's own last-30-day numbers (returned too, so they can be checked). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const { question } = schema.parse(await request.json());
    const facts = await getAdvisorFacts(session.tenantId);
    const result = await runAssistForTenant<AdvisorOutput>(session.tenantId, "advisor", { question, facts });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, ...result.output, facts });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Type a question." }, { status: 400 });
    console.error("[insights/advisor]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
