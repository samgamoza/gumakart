import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, voidPosSale } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";
import { assertPosManager, requireOpenShiftId } from "@/lib/pos-after-sale";

/** Void a sale from the current shift (manager/owner): stock back, out of the drawer. */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    assertPosManager(actor);
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const { reason } = z.object({ reason: z.string().trim().min(1, "Say why the sale is voided.").max(200) }).parse(await request.json());
    const shiftId = await requireOpenShiftId(actor.tenantId);
    const result = await voidPosSale(actor.tenantId, saleId, { openShiftId: shiftId, reason }, {
      userId: actor.userId,
      name: actor.name,
      posStaffId: actor.staffId,
    });
    await logActivity(actor.tenantId, { userId: actor.userId, name: actor.name, role: actor.staffId ? `pos_${actor.role}` : actor.role }, {
      action: "pos.sale_voided",
      entityType: "order",
      entityId: saleId,
      summary: result.summary,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return posErrorResponse(error, "void");
  }
}
