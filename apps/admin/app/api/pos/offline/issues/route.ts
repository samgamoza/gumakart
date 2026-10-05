import { NextResponse } from "next/server";
import { z } from "zod";
import { listSyncIssues, logActivity, resolveSyncIssue } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";
import { assertPosManager } from "@/lib/pos-after-sale";

/** Offline sales that need a look (managers and owners). `?all=1` includes resolved ones. */
export async function GET(request: Request) {
  try {
    const actor = await requirePosActor();
    assertPosManager(actor);
    const all = new URL(request.url).searchParams.get("all") === "1";
    const issues = await listSyncIssues(actor.tenantId, { open: !all, limit: 100 });
    return NextResponse.json({ ok: true, issues });
  } catch (error) {
    return posErrorResponse(error, "sync issues");
  }
}

/** Mark one as checked. */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    assertPosManager(actor);
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const done = await resolveSyncIssue(actor.tenantId, id, actor.name);
    if (!done) return NextResponse.json({ ok: false, error: "Already checked." }, { status: 404 });
    await logActivity(actor.tenantId, { userId: actor.userId, name: actor.name, role: actor.staffId ? `pos_${actor.role}` : actor.role }, {
      action: "pos.offline_issue_resolved",
      entityType: "pos_sync_issue",
      entityId: id,
      summary: "Marked an offline-sale issue as checked",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return posErrorResponse(error, "sync issues");
  }
}
