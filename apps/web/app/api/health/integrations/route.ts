import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  integrationHealthPayload,
  logIntegrationStatusOnce,
} from "@gumakart/services";

export const dynamic = "force-dynamic";

/**
 * Integration posture for MVP release hardening.
 * Never returns secret values — only configured / missing / mock_allowed.
 */
export async function GET(request: Request) {
  // Security G1: which integrations are configured is for operators, not the public.
  // The cron worker's bearer secret (or dev without one) opens it; everyone else gets a bare 200.
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  logIntegrationStatusOnce();
  const payload = integrationHealthPayload();
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
