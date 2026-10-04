import { NextResponse } from "next/server";
import { z } from "zod";
import { closeShift, ensureRegister, getOpenShift, getShiftSummary, PosError } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

const amount = z.number().min(0).max(10_000_000);
const bodySchema = z.object({
  shiftId: z.string().uuid(),
  counted: z.object({ cash: amount, gcash: amount, maya: amount, card: amount }),
  note: z.string().max(500).optional(),
});

/** Close the shift: counted vs expected per payment method. */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    const body = bodySchema.parse(await request.json());
    const register = await ensureRegister(actor.tenantId);
    const open = await getOpenShift(actor.tenantId, register.id);
    if (!open || open.id !== body.shiftId) throw new PosError("This shift is already closed.", "SHIFT_CLOSED");
    const summary = await getShiftSummary(actor.tenantId, body.shiftId);
    const shift = await closeShift({
      tenantId: actor.tenantId,
      shiftId: body.shiftId,
      counted: body.counted,
      note: body.note,
      staffId: actor.staffId,
      userId: actor.userId,
    });
    return NextResponse.json({ ok: true, shift, summary });
  } catch (error) {
    return posErrorResponse(error, "close shift");
  }
}
