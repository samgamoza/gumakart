import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, canResetPassword, issueEmailCode } from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { deliverEmailCode } from "@/lib/email-code-mailer";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address.").max(255) });

/** Same answer whether or not an account uses this email (no account discovery). */
const SENT = { ok: true, message: "If an account uses this email, we sent a 6-digit code. Check your inbox (and spam)." };

/** Phase 19: forgot password, step 1 — email a reset code (sellers, staff, partners). */
export async function POST(request: Request) {
  try {
    const byIp = await rateLimit(`pw-forgot-ip:${clientIpFrom(request)}`, { limit: 8, windowSeconds: 3600 });
    if (!byIp.allowed) {
      return NextResponse.json({ ok: false, error: "Too many attempts from this connection. Try again later." }, { status: 429, headers: { "Retry-After": String(byIp.retryAfterSeconds) } });
    }
    const { email } = schema.parse(await request.json());
    const byEmail = await rateLimit(`pw-forgot-email:${email.toLowerCase()}`, { limit: 5, windowSeconds: 3600 });
    if (!byEmail.allowed || !(await canResetPassword(email))) return NextResponse.json(SENT);
    try {
      const { code } = await issueEmailCode(email, "reset");
      const delivery = await deliverEmailCode(email, code, "reset");
      if (!delivery.ok) return NextResponse.json({ ok: false, error: delivery.error }, { status: 503 });
      return NextResponse.json({ ...SENT, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) });
    } catch (error) {
      // A cooldown means a code went out a moment ago — answer the same way.
      if (error instanceof AuthError && error.code === "CODE_COOLDOWN") return NextResponse.json(SENT);
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    console.error("[auth/password/forgot]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
