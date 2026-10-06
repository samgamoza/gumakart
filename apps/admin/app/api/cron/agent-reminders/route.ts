import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { PLAN_AI_LIMITS, normalizePlan } from "@gumakart/ai";
import { createSemaphoreClient } from "@gumakart/services";
import {
  getDb,
  getTenantOwnerContact,
  listActiveTenantsForAgents,
  listContentQueue,
  resolveAgentSettings,
  tenants,
} from "@gumakart/db";
import { isCronAuthorized } from "@/lib/cron-auth";


function todayManilaKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sms = createSemaphoreClient();
  const adminBase = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
  const activeTenants = await listActiveTenantsForAgents();
  let reminded = 0;

  for (const tenant of activeTenants) {
    const plan = normalizePlan(tenant.subscriptionPlan);
    if (!PLAN_AI_LIMITS[plan].smsReminders) continue;

    const settings = resolveAgentSettings(tenant.settingsJson as Record<string, unknown>);
    if (!settings.postingEnabled) continue;

    const agentsConfig = (tenant.settingsJson as Record<string, unknown>)?.agents as
      | { lastReminderDate?: string }
      | undefined;
    if (agentsConfig?.lastReminderDate === todayManilaKey()) continue;

    const draftQueue = await listContentQueue(tenant.id, ["draft", "approved"]);
    if (draftQueue.length === 0) continue;

    const owner = await getTenantOwnerContact(tenant.id);
    if (owner.phone) {
      await sms.send({
        to: owner.phone,
        message: `Guma One: ${draftQueue.length} post${draftQueue.length === 1 ? "" : "s"} ready for ${tenant.name}. Review: ${adminBase}/agents`,
      });
    }

    const db = getDb();
    const currentSettings = (tenant.settingsJson as Record<string, unknown>) ?? {};
    const currentAgents = (currentSettings.agents as Record<string, unknown>) ?? {};
    await db
      .update(tenants)
      .set({
        settingsJson: {
          ...currentSettings,
          agents: { ...currentAgents, lastReminderDate: todayManilaKey() },
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id));

    reminded += 1;
  }

  return NextResponse.json({ ok: true, reminded });
}
