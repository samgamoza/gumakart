import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, validatePosPin } from "@gumakart/auth";
import { setStaffPin } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { staffFail } from "../../_errors";

/** Set or reset the POS quick-unlock PIN for a staff account. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { userId } = await params;
    z.string().uuid().parse(userId);
    const body = z.object({ pin: z.string(), name: z.string().max(80).optional() }).parse(await request.json());
    const check = validatePosPin(body.pin);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
    await setStaffPin(session.tenantId, userId, await hashPassword(body.pin));
    await recordActivity(session, {
      action: "staff.pin_set",
      entityType: "staff",
      entityId: userId,
      summary: `Set a POS PIN for ${body.name ?? "a staff member"}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return staffFail(error, "pin");
  }
}
