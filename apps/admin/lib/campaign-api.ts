import { NextResponse } from "next/server";
import { z } from "zod";
import { CampaignError, SEGMENT_KINDS } from "@gumakart/db";
import { ApiAuthError } from "@/lib/api-auth";

export const segmentSchema = z.object({
  kind: z.enum(SEGMENT_KINDS),
  minSpend: z.number().min(1).max(10_000_000).optional(),
  days: z.number().int().min(1).max(730).optional(),
  channel: z.string().max(20).optional(),
  /** Phase 32: Suki win-back. */
  minTier: z.enum(["silver", "gold", "platinum"]).optional(),
});

export function campaignFail(error: unknown, label: string): NextResponse {
  if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  if (error instanceof CampaignError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
  if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
  console.error(`[campaigns] ${label}`, error);
  return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
}
