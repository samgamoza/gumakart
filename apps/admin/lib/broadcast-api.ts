import { NextResponse } from "next/server";
import { z } from "zod";
import { BroadcastError, getTenantSettings } from "@gumakart/db";
import { getAiSuiteTier } from "@gumakart/plans";
import { ApiAuthError } from "@/lib/api-auth";

export const broadcastSchema = z.object({
  name: z.string().trim().min(1).max(120),
  channel: z.enum(["messenger", "instagram", "whatsapp"]),
  kind: z.enum(["payday", "restock", "custom"]),
  segmentTags: z.array(z.enum(["VIP_REPEAT", "PAYDAY_SHOPPER", "INACTIVE_60D"])).max(3),
  messageTemplate: z.string().trim().min(5).max(1000),
  waTemplateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,120}$/, "WhatsApp template names are lowercase letters, numbers and _")
    .nullish()
    .or(z.literal("")),
  waTemplateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).nullish(),
  productId: z.string().uuid().nullish(),
  aiPolished: z.boolean().optional(),
  rateLimitPerSec: z.number().int().min(1).max(10).optional(),
});

export class BroadcastPlanError extends Error {}

/** Broadcasts are Pro Live / Enterprise Vibe. */
export async function assertBroadcastPlan(tenantId: string): Promise<void> {
  const s = await getTenantSettings(tenantId);
  if (!getAiSuiteTier(s?.subscriptionPlan).broadcastEnabled) {
    throw new BroadcastPlanError("Payday & restock broadcasts are part of Pro Live and Enterprise Vibe.");
  }
}

export function broadcastFail(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof BroadcastPlanError) return NextResponse.json({ ok: false, error: error.message, code: "PLAN" }, { status: 403 });
  if (error instanceof BroadcastError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  console.error(`[broadcasts] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
