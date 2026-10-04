import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, validatePosPin } from "@gumakart/auth";
import { createPosStaff, listPosStaff, listRecentShifts } from "@gumakart/db";
import { posErrorResponse, requirePosOwner } from "@/lib/pos-auth";

/** Owner only: the shop's POS team and recent shifts. */
export async function GET() {
  try {
    const owner = await requirePosOwner();
    const [staff, shifts] = await Promise.all([listPosStaff(owner.tenantId), listRecentShifts(owner.tenantId, 10)]);
    return NextResponse.json({ ok: true, staff, shifts });
  } catch (error) {
    return posErrorResponse(error, "staff list");
  }
}

const bodySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60),
  role: z.enum(["cashier", "manager"]).default("cashier"),
  pin: z.string(),
});

export async function POST(request: Request) {
  try {
    const owner = await requirePosOwner();
    const body = bodySchema.parse(await request.json());
    const pinCheck = validatePosPin(body.pin);
    if (!pinCheck.ok) return NextResponse.json({ ok: false, error: pinCheck.reason }, { status: 400 });
    const staff = await createPosStaff({
      tenantId: owner.tenantId,
      name: body.name,
      role: body.role,
      pinHash: await hashPassword(body.pin),
    });
    return NextResponse.json({ ok: true, staff });
  } catch (error) {
    return posErrorResponse(error, "staff create");
  }
}
