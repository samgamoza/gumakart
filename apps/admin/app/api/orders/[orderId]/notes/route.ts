import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOrderNotes } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { afterSaleFail } from "@/lib/after-sale";

const schema = z.object({
  staffNote: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

/** Seller-only note and tags (never shown to the buyer). */
export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const body = schema.parse(await request.json());
    const result = await updateOrderNotes(session.tenantId, orderId, body);
    if (body.tags !== undefined) {
      await recordActivity(session, { action: "order.tagged", entityType: "order", entityId: orderId, summary: `Tags: ${result.tags.join(", ") || "none"}` });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return afterSaleFail(error, "order notes");
  }
}
