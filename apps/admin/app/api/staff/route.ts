import { NextResponse } from "next/server";
import { z } from "zod";
import { createStaffInvite, INVITE_TTL_DAYS, listTeam, STAFF_ROLE_VALUES } from "@gumakart/db";
import { isEmailConfigured, sendTransactionalEmail } from "@gumakart/services";
import { ROLE_LABELS } from "@gumakart/db/staff-permissions";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { adminUrl } from "@/lib/utils";
import { staffFail } from "./_errors";

/** Owner only (staff.manage): the team and open invites. */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const team = await listTeam(session.tenantId);
    return NextResponse.json({ ok: true, ...team, emailConfigured: isEmailConfigured() });
  } catch (error) {
    return staffFail(error, "GET");
  }
}

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(255),
  name: z.string().trim().max(80).optional(),
  role: z.enum(STAFF_ROLE_VALUES),
});

/**
 * Invite someone. Returns the link once — the owner can copy it into Messenger/SMS.
 * When email (Resend) is set up, it's also emailed; otherwise `emailed: false`.
 */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = inviteSchema.parse(await request.json());
    const { invite, token } = await createStaffInvite(session.tenantId, body, session.userId);
    const url = `${adminUrl}/invite/${token}`;
    const roleLabel = ROLE_LABELS[invite.role].label;

    let emailed = false;
    if (isEmailConfigured()) {
      const result = await sendTransactionalEmail({
        to: invite.email,
        subject: `${session.tenantName} invited you to their Guma Kart shop`,
        text: [
          `Hi${invite.name ? ` ${invite.name}` : ""},`,
          "",
          `${session.displayName ?? "The owner"} added you to ${session.tenantName} on Guma Kart as ${roleLabel}.`,
          `Open this link to set your password and start: ${url}`,
          "",
          `The link works once and expires in ${INVITE_TTL_DAYS} days.`,
        ].join("\n"),
        tags: [{ name: "type", value: "staff_invite" }],
      });
      emailed = result.sent;
    }

    await recordActivity(session, {
      action: "staff.invited",
      entityType: "staff",
      entityId: invite.id,
      summary: `Invited ${invite.name ? `${invite.name} (${invite.email})` : invite.email} as ${roleLabel}`,
    });
    return NextResponse.json({ ok: true, invite, url, emailed });
  } catch (error) {
    return staffFail(error, "invite");
  }
}
