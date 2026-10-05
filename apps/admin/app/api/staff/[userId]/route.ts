import { NextResponse } from "next/server";
import { z } from "zod";
import { changeStaffRole, removeStaff, STAFF_ROLE_VALUES } from "@gumakart/db";
import { ROLE_LABELS } from "@gumakart/db/staff-permissions";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { staffFail } from "../_errors";

const patchSchema = z.object({ role: z.enum(STAFF_ROLE_VALUES), name: z.string().max(80).optional() });

/** Change a staff member's role (they're signed out so the new role applies at once). */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { userId } = await params;
    z.string().uuid().parse(userId);
    const body = patchSchema.parse(await request.json());
    const { from } = await changeStaffRole(session.tenantId, userId, body.role);
    const fromLabel = from && from in ROLE_LABELS ? ROLE_LABELS[from as keyof typeof ROLE_LABELS].label : "—";
    await recordActivity(session, {
      action: "staff.role_changed",
      entityType: "staff",
      entityId: userId,
      summary: `Changed ${body.name ?? "a staff member"}'s role: ${fromLabel} → ${ROLE_LABELS[body.role].label}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return staffFail(error, "role");
  }
}

/** Remove from the shop: signed out everywhere, PIN off, history kept. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { userId } = await params;
    z.string().uuid().parse(userId);
    if (userId === session.userId) {
      return NextResponse.json({ ok: false, error: "You can't remove yourself." }, { status: 400 });
    }
    const { name } = await removeStaff(session.tenantId, userId);
    await recordActivity(session, { action: "staff.removed", entityType: "staff", entityId: userId, summary: `Removed ${name} from the shop` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return staffFail(error, "remove");
  }
}
