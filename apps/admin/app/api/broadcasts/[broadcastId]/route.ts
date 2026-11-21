import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelBroadcast, getBroadcast, queueBroadcast, updateBroadcast } from "@gumakart/db";
import { assertCan, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { assertBroadcastPlan, broadcastFail, broadcastSchema } from "@/lib/broadcast-api";

type Ctx = { params: Promise<{ broadcastId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    const { broadcastId } = await params;
    z.string().uuid().parse(broadcastId);
    const b = await getBroadcast(session.tenantId, broadcastId);
    if (!b) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, broadcast: b });
  } catch (error) {
    return broadcastFail(error, "get");
  }
}

/** Edit a draft. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const { broadcastId } = await params;
    z.string().uuid().parse(broadcastId);
    const b = broadcastSchema.parse(await request.json());
    const updated = await updateBroadcast(session.tenantId, broadcastId, { ...b, waTemplateName: b.waTemplateName || null });
    return NextResponse.json({ ok: true, broadcast: updated });
  } catch (error) {
    return broadcastFail(error, "update");
  }
}

/** Queue (freeze recipients + schedule) or cancel. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await requireTenantSession();
    assertCan(session, "marketing.manage");
    const { broadcastId } = await params;
    z.string().uuid().parse(broadcastId);
    const body = z.object({ action: z.enum(["queue", "cancel"]), sendAt: z.string().datetime().nullish() }).parse(await request.json());
    if (body.action === "cancel") {
      const b = await cancelBroadcast(session.tenantId, broadcastId);
      await recordActivity(session, { action: "broadcast.cancelled", entityType: "broadcast", entityId: broadcastId, summary: `Cancelled broadcast "${b.name}"` });
      return NextResponse.json({ ok: true, broadcast: b });
    }
    await assertBroadcastPlan(session.tenantId);
    const b = await queueBroadcast(session.tenantId, broadcastId, body.sendAt ? new Date(body.sendAt) : null);
    await recordActivity(session, {
      action: "broadcast.queued",
      entityType: "broadcast",
      entityId: broadcastId,
      summary: `Scheduled broadcast "${b.name}" to ${b.recipients - b.skipped} buyer(s) on ${b.channel}`,
    });
    return NextResponse.json({ ok: true, broadcast: b });
  } catch (error) {
    return broadcastFail(error, "action");
  }
}
