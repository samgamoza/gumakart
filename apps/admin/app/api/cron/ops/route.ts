import { NextResponse } from "next/server";
import { z } from "zod";
import { captureError } from "@/lib/errors";
import { reportAndMonitor } from "@/lib/ops-monitor";
import { isCronAuthorized } from "@/lib/cron-auth";


const bodySchema = z.object({
  runs: z
    .array(
      z.object({
        job: z.string().max(80),
        startedAt: z.string().datetime(),
        durationMs: z.number().min(0).max(3_600_000),
        ok: z.boolean(),
        statusCode: z.number().int().nullable().optional(),
        summary: z.string().max(500).optional(),
      })
    )
    .max(50)
    .default([]),
});

/** Phase 16: the cron worker reports each tick's job runs here; then the alert rules run. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { runs } = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await reportAndMonitor(runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt) })));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await captureError("POST /api/cron/ops", error);
    console.error("[cron ops]", error);
    return NextResponse.json({ ok: false, error: "Monitor run failed." }, { status: 500 });
  }
}

/** GET runs the alert rules only (handy in dev, where no cron worker runs). */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await reportAndMonitor([])) });
}
