import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, changePassword, getSessionFromRequest, isSessionCurrent, sessionCookieHeader } from "@gumakart/auth";
import { clientIpFrom, isEmailConfigured, rateLimit, sendTransactionalEmail } from "@gumakart/services";

const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(200),
  newPassword: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

/** Phase 21: Settings → Account → Change password. Other devices are signed out. */
export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.supportAccess || !(await isSessionCurrent(session.userId, session.sessionVersion))) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const limited = await rateLimit(`pw-change:${session.userId}:${clientIpFrom(request)}`, { limit: 8, windowSeconds: 900 });
  if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
  try {
    const body = schema.parse(await request.json());
    const { user, sessionToken } = await changePassword({ userId: session.userId, ...body });
    if (isEmailConfigured()) {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Your Guma Kart password was changed",
        text: [
          `Hi ${user.displayName},`,
          "",
          "Your Guma Kart password was just changed from Settings, and every other device was signed out.",
          "If this wasn't you, use \"Forgot password?\" on the sign-in page right away and contact Guma Kart support.",
        ].join("\n"),
      }).catch(() => null);
    }
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
    return response;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    console.error("[account/password]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
