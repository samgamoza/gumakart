import { NextResponse } from "next/server";
import { normalizePlan, runSellerAssist, type AssistInput, type AssistTask } from "@gumakart/ai";
import { recordAiUsage } from "@gumakart/db";
import { rateLimit } from "@gumakart/services";
import { assertAiQuota, getUsageSnapshot } from "@/lib/agents/usage-gate";

/**
 * Phase 26: runs one AI-assistant task for a shop with the plan's limits.
 *  - captions use a monthly "AI generation" (same pool as the AI Studio)
 *  - replies and Ask Guma are lighter: a daily allowance per plan (free 15, Pro 150, Advance 400)
 * Tokens always count toward the monthly soft budget, which switches to the thrifty model when used up.
 */
const DAILY_LIGHT: Record<"free" | "growth" | "pro", number> = { free: 15, growth: 150, pro: 400 };

export type AssistOutcome<T> = { ok: true; output: T; model: string } | { ok: false; response: NextResponse };

export async function runAssistForTenant<T>(tenantId: string, task: AssistTask, input: AssistInput): Promise<AssistOutcome<T>> {
  const usage = await getUsageSnapshot(tenantId);
  const plan = normalizePlan(usage.plan);
  if (task === "captions") {
    const quota = await assertAiQuota(tenantId, "generation");
    if (!quota.allowed) {
      return { ok: false, response: NextResponse.json({ ok: false, error: quota.reason, upgradeRequired: true }, { status: 402 }) };
    }
  } else {
    const limit = DAILY_LIGHT[plan];
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const r = await rateLimit(`ai-light:${tenantId}:${day}`, { limit, windowSeconds: 86_400 });
    if (!r.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: `You've used today's ${limit} AI suggestions. They reset tomorrow${plan === "pro" ? "." : " — or upgrade for more."}`, upgradeRequired: plan !== "pro" },
          { status: 429 }
        ),
      };
    }
  }
  try {
    const result = await runSellerAssist(task, input, { plan, tokensUsedThisMonth: usage.tokensThisMonth });
    await recordAiUsage(tenantId, { incrementGenerations: task === "captions", tokensUsed: result.tokensUsed }).catch((e) =>
      console.error("[ai-assist] usage", e)
    );
    return { ok: true, output: result.output as T, model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-assist] ${task}`, message);
    const notSetUp = /not configured|No LLM API key|not allowed in production/i.test(message);
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: notSetUp ? "AI isn't set up for this site yet." : "The AI couldn't answer just now. Try again in a moment." },
        { status: 503 }
      ),
    };
  }
}
