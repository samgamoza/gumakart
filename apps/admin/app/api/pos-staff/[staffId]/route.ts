import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, validatePosPin } from "@gumakart/auth";
import { updatePosStaff } from "@gumakart/db";
import { posErrorResponse, requirePosOwner } from "@/lib/pos-auth";

const bodySchema = z
  .object({
    role: z.enum(["cashier", "manager"]).optional(),
    active: z.boolean().optional(),
    pin: z.string().optional(),
  })
  .strict();

/** Owner only: change role, reset PIN, or turn someone off. Any of these signs them out of the register. */
export async function PATCH(request: Request, { params }: { params: Promise<{ staffId: string }> }) {
  try {
    const owner = await requirePosOwner();
    const { staffId } = await params;
    z.string().uuid().parse(staffId);
    const body = bodySchema.parse(await request.json());
    let pinHash: string | undefined;
    if (body.pin !== undefined) {
      const check = validatePosPin(body.pin);
      if (!check.ok) return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
      pinHash = await hashPassword(body.pin);
    }
    const ok = await updatePosStaff(owner.tenantId, staffId, { role: body.role, active: body.active, pinHash });
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return posErrorResponse(error, "staff update");
  }
}
