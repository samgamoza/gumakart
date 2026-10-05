import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeStaffInvite } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { staffFail } from "../../_errors";

export async function DELETE(_request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { inviteId } = await params;
    z.string().uuid().parse(inviteId);
    const ok = await revokeStaffInvite(session.tenantId, inviteId);
    if (!ok) return NextResponse.json({ ok: false, error: "Invite not found." }, { status: 404 });
    await recordActivity(session, { action: "staff.invite_cancelled", entityType: "staff", entityId: inviteId, summary: "Cancelled an invite" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return staffFail(error, "revoke");
  }
}
