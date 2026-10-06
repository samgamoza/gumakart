import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, resetPasswordWithCode } from "@gumakart/auth";
import { signInJson } from "@/lib/two-factor-sign-in";
import { homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";
import { clientIpFrom, isEmailConfigured, rateLimit, sendTransactionalEmail } from "@gumakart/services";

const schema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().trim().min(6).max(12),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

/**
 * Phase 19: forgot password, step 2 — code + new password. Every other session is signed out
 * (session version bump); this device gets a fresh one. The owner of the inbox gets a notice.
 */
export async function POST(request: Request) {
  try {
    const byIp = await rateLimit(`pw-reset-ip:${clientIpFrom(request)}`, { limit: 15, windowSeconds: 900 });
    if (!byIp.allowed) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(byIp.retryAfterSeconds) } });
    }
    const body = schema.parse(await request.json());
    const { user, sessionToken } = await resetPasswordWithCode(body);
    if (isEmailConfigured()) {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Your Guma Kart password was changed",
        text: [
          `Hi ${user.displayName},`,
          "",
          "Your Guma Kart password was just changed, and every other device was signed out.",
          "If this wasn't you, reset it again right away and contact Guma Kart support.",
        ].join("\n"),
      }).catch(() => null);
    }
    const role = shopRoleOf(user);
    const redirectTo = user.role === "partner" ? "/partner" : role && role !== "owner" ? homeFor(role) : "/";
    // Phase 21: the reset changes the password, but an emailed code is not a second factor —
    // accounts with two-step sign-in still enter their authenticator code before a session.
    return signInJson(user, sessionToken, { redirectTo, passwordChanged: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    console.error("[auth/password/reset]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
