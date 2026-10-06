import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureRegister, openShift } from "@gumakart/db";
import { posErrorResponse, requirePosActor, posBranchId } from "@/lib/pos-auth";

const bodySchema = z.object({ openingCash: z.number().min(0).max(1_000_000) });

/** Open the shift with the cash already in the drawer. */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    const body = bodySchema.parse(await request.json());
    const register = await ensureRegister(actor.tenantId, await posBranchId());
    const shift = await openShift({
      tenantId: actor.tenantId,
      registerId: register.id,
      openingCash: body.openingCash,
      staffId: actor.staffId,
      userId: actor.userId,
    });
    return NextResponse.json({ ok: true, shift });
  } catch (error) {
    return posErrorResponse(error, "open shift");
  }
}
