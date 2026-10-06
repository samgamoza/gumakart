import { NextResponse } from "next/server";
import { z } from "zod";
import { applyOrderAction, getPackingSlips } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const schema = z.object({
  action: z.literal("mark_ready"),
  orderIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Phase 24: mark many orders packed at once (after printing the slips and pick list). Each order goes
 * through the same order service as the one-by-one button; ones that can't move are listed, not forced.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    // Only this shop's orders (getPackingSlips filters by tenant) — also gives us the order numbers.
    const own = await getPackingSlips(session.tenantId, body.orderIds);
    const done: string[] = [];
    const skipped: Array<{ orderNumber: string; reason: string }> = [];
    for (const o of own) {
      try {
        const result = await applyOrderAction({ orderId: o.id, tenantId: session.tenantId, action: { type: "mark_ready" }, source: "seller", actorId: session.userId });
        if (result.changed) done.push(o.orderNumber);
        else skipped.push({ orderNumber: o.orderNumber, reason: "Already packed" });
      } catch (error) {
        skipped.push({ orderNumber: o.orderNumber, reason: error instanceof Error ? error.message : "Can't be packed yet" });
      }
    }
    if (done.length) {
      await recordActivity(session, {
        action: "order.mark_ready_bulk",
        entityType: "order",
        entityId: null,
        summary: `Marked ${done.length} order${done.length === 1 ? "" : "s"} packed: ${done.slice(0, 10).join(", ")}${done.length > 10 ? "…" : ""}`,
      });
    }
    return NextResponse.json({ ok: true, done, skipped });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Pick up to 50 orders." }, { status: 400 });
    console.error("[orders bulk]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
