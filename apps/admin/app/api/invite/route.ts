import { NextResponse } from "next/server";
import { signInJson } from "@/lib/two-factor-sign-in";
import { z } from "zod";
import {
  createSessionToken,
  getUserSessionById,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "@gumakart/auth";
import { acceptStaffInvite, getInviteAccount, getStaffInvite, logActivity, StaffError } from "@gumakart/db";
import { homeFor, ROLE_LABELS } from "@gumakart/db/staff-permissions";
import { clientIpFrom, rateLimit } from "@gumakart/services";

/**
 * Public: view and accept a staff invite (the token in the link is the credential).
 * Rate-limited per IP; tokens are 192-bit random and stored hashed.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const limited = await rateLimit(`invite-view:${clientIpFrom(request)}`, { limit: 30, windowSeconds: 300 });
  if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
  const invite = await getStaffInvite(token);
  if (!invite) return NextResponse.json({ ok: false, error: "This invite link isn't valid." }, { status: 404 });
  return NextResponse.json({ ok: true, invite: { ...invite, roleLabel: ROLE_LABELS[invite.role].label, roleDescription: ROLE_LABELS[invite.role].description } });
}

const acceptSchema = z.object({
  token: z.string().min(10).max(100),
  name: z.string().trim().min(1, "Enter your name.").max(80),
  password: z.string().min(1, "Enter a password.").max(200),
});

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`invite-accept:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 300 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
    const body = acceptSchema.parse(await request.json());
    const invite = await getStaffInvite(body.token);
    if (!invite) return NextResponse.json({ ok: false, error: "This invite link isn't valid." }, { status: 404 });

    let accepted;
    if (invite.hasAccount) {
      const account = await getInviteAccount(invite.email);
      const ok = account?.passwordHash ? await verifyPassword(body.password, account.passwordHash) : false;
      if (!account || !ok) {
        return NextResponse.json({ ok: false, error: "Wrong password for this email." }, { status: 401 });
      }
      accepted = await acceptStaffInvite({ token: body.token, name: body.name, existingUserId: account.id });
    } else {
      const strength = validatePasswordStrength(body.password);
      if (!strength.ok) return NextResponse.json({ ok: false, error: strength.reason }, { status: 400 });
      accepted = await acceptStaffInvite({ token: body.token, name: body.name, passwordHash: await hashPassword(body.password) });
    }

    const user = await getUserSessionById(accepted.userId);
    if (!user) throw new Error("accepted user missing");
    await logActivity(
      accepted.tenantId,
      { userId: accepted.userId, name: body.name, role: accepted.role },
      { action: "staff.joined", entityType: "staff", entityId: accepted.userId, summary: `${body.name} joined as ${ROLE_LABELS[accepted.role].label}` }
    );
    // Phase 21: an existing account with two-step sign-in still enters its code.
    return signInJson(user, await createSessionToken(user), { redirectTo: homeFor(accepted.role) });
  } catch (error) {
    if (error instanceof StaffError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
    }
    console.error("[invite accept]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
