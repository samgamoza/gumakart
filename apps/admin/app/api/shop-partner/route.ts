import { NextResponse } from "next/server";
import { z } from "zod";
import { getShopPartner, grantPartnerAccess, lookupPartnerCode, revokePartnerAccess } from "@gumakart/db";
import { isEmailConfigured, sendTransactionalEmail } from "@gumakart/services";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { partnerFail } from "@/lib/partner-api";
import { adminUrl } from "@/lib/utils";

/**
 * Phase 18 — owner only (unmatched path = owner-only in staff-permissions; checked again here,
 * and a partner can never manage partner access, even as Manager).
 */
async function owner() {
  const session = await requireTenantSession();
  if (session.shopRole !== "owner" || session.partnerName || session.supportAccess) {
    throw Object.assign(new Error("Only the shop owner can manage partner access."), { status: 403 });
  }
  return session;
}

function denied(error: unknown) {
  if (error instanceof Error && (error as { status?: number }).status === 403) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const session = await owner();
    const code = new URL(request.url).searchParams.get("code");
    if (code) {
      const p = await lookupPartnerCode(code);
      if (!p || p.status === "suspended") return NextResponse.json({ ok: false, error: "No partner with that code." }, { status: 404 });
      return NextResponse.json({ ok: true, preview: { name: p.name, code: p.code, city: p.city, website: p.website, approved: p.status === "active" } });
    }
    return NextResponse.json({ ok: true, ...(await getShopPartner(session.tenantId)) });
  } catch (error) {
    return denied(error) ?? partnerFail(error, "shop get");
  }
}

const grantSchema = z.object({ code: z.string().min(4).max(16), role: z.enum(["manager", "staff"]) });

export async function POST(request: Request) {
  try {
    const session = await owner();
    const body = grantSchema.parse(await request.json());
    const res = await grantPartnerAccess({ tenantId: session.tenantId, code: body.code, role: body.role, ownerUserId: session.userId });
    if (res.changed) {
      await recordActivity(session, { action: "partner.granted", summary: `Gave ${res.name} (partner) ${body.role === "manager" ? "Manager" : "Staff"} access` });
      if (isEmailConfigured() && res.contactEmail) {
        await sendTransactionalEmail({
          to: res.contactEmail,
          subject: `${session.tenantName} gave you access on Guma Kart`,
          text: [
            `Hi ${res.name},`,
            "",
            `${session.tenantName} added you as their partner on Guma Kart (${body.role === "manager" ? "Manager" : "Staff"} access).`,
            `Open your partner dashboard to work in their shop: ${adminUrl}/partner`,
          ].join("\n"),
        }).catch(() => null);
      }
    }
    return NextResponse.json({ ok: true, ...(await getShopPartner(session.tenantId)) });
  } catch (error) {
    return denied(error) ?? partnerFail(error, "grant");
  }
}

export async function DELETE() {
  try {
    const session = await owner();
    const before = await getShopPartner(session.tenantId);
    const res = await revokePartnerAccess(session.tenantId);
    if (res && before.access) {
      await recordActivity(session, { action: "partner.revoked", summary: `Removed ${before.access.name} (partner) access` });
    }
    return NextResponse.json({ ok: true, ...(await getShopPartner(session.tenantId)) });
  } catch (error) {
    return denied(error) ?? partnerFail(error, "revoke");
  }
}
