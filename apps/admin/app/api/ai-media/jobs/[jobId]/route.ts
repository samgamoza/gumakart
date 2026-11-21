import { NextResponse } from "next/server";
import { getAiMediaJob } from "@gumakart/db";
import { ApiAuthError, assertCan, requireTenantSession } from "@/lib/api-auth";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const { jobId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    const job = await getAiMediaJob(session.tenantId, jobId);
    if (!job) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      job: { id: job.id, jobType: job.jobType, status: job.status, outputs: job.outputUrls, error: job.status === "failed" ? job.errorMessage : null, createdAt: job.createdAt, completedAt: job.completedAt },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[ai-media/jobs/:id]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
