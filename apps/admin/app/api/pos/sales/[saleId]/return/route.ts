import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, recordReturn } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";
import { assertPosManager, requireOpenShiftId } from "@/lib/pos-after-sale";

const schema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1).max(999),
        restock: z.boolean(),
        replacementVariantId: z.string().uuid().nullish(),
      })
    )
    .max(100),
  refundAmount: z.number().min(0).max(10_000_000),
  collectedAmount: z.number().min(0).max(10_000_000).optional(),
  refundMethod: z.enum(["cash", "gcash", "maya", "card", "none"]),
  note: z.string().max(300).nullish(),
});

/** Return or exchange at the register: refund comes out of this shift's drawer. */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    assertPosManager(actor);
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const body = schema.parse(await request.json());
    const shiftId = await requireOpenShiftId(actor.tenantId);
    const result = await recordReturn(
      actor.tenantId,
      saleId,
      { ...body, registerSessionId: shiftId },
      { userId: actor.userId, name: actor.name, posStaffId: actor.staffId }
    );
    await logActivity(actor.tenantId, { userId: actor.userId, name: actor.name, role: actor.staffId ? `pos_${actor.role}` : actor.role }, {
      action: "pos.return",
      entityType: "order",
      entityId: saleId,
      summary: result.summary,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return posErrorResponse(error, "pos return");
  }
}
