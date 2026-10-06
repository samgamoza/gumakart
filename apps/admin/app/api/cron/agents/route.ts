import { NextResponse } from "next/server";
import {
  listActiveTenantsForAgents,
  resolveAgentSettings,
} from "@gumakart/db";
import { runCampaignAgent, runPostingAgent } from "@/lib/agents/run-agents";
import { assertAiQuota } from "@/lib/agents/usage-gate";
import { isCronAuthorized } from "@/lib/cron-auth";


export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "daily";
  const tenants = await listActiveTenantsForAgents();
  let processed = 0;
  let itemsCreated = 0;

  for (const tenant of tenants) {
    const settings = resolveAgentSettings(tenant.settingsJson as Record<string, unknown>);
    if (!settings.postingEnabled && !settings.campaignEnabled) continue;

    const ctx = {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      category: tenant.category,
      themeJson: tenant.themeJson,
      settingsJson: tenant.settingsJson,
      subscriptionPlan: tenant.subscriptionPlan,
    };

    try {
      if (settings.postingEnabled && (mode === "daily" || settings.postingSchedule === "daily")) {
        if (settings.postingSchedule !== "manual") {
          const quota = await assertAiQuota(tenant.id, "agent_post");
          if (!quota.allowed) continue;

          itemsCreated += await runPostingAgent(ctx, settings);
          processed += 1;
        }
      }
      if (
        settings.campaignEnabled &&
        (mode === "weekly" || settings.postingSchedule === "weekly")
      ) {
        const quota = await assertAiQuota(tenant.id, "agent_campaign");
        if (!quota.allowed) continue;

        itemsCreated += await runCampaignAgent(ctx);
        processed += 1;
      }
    } catch (error) {
      console.error(`Cron agent failed for ${tenant.slug}:`, error);
    }
  }

  return NextResponse.json({ ok: true, processed, itemsCreated });
}
