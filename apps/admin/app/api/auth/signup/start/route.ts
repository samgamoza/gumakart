import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, isEmailRegistered, issueEmailCode, validatePasswordStrength } from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { deliverEmailCode } from "@/lib/email-code-mailer";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(255),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  displayName: z.string().trim().min(2, "Enter your name.").max(100),
});

/** Step 1 of signup: check the details and email a 6-digit code. Creates nothing yet. */
export async function POST(request: Request) {
  try {
    const ip = clientIpFrom(request);
    const byIp = await rateLimit(`signup-code-ip:${ip}`, { limit: 8, windowSeconds: 3600 });
    if (!byIp.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts from this connection. Try again later." },
        { status: 429, headers: { "Retry-After": String(byIp.retryAfterSeconds) } }
      );
    }

    const body = schema.parse(await request.json());
    const strength = validatePasswordStrength(body.password);
    if (!strength.ok) {
      return NextResponse.json({ ok: false, error: strength.reason, code: "WEAK_PASSWORD" }, { status: 400 });
    }

    const byEmail = await rateLimit(`signup-code-email:${body.email.toLowerCase()}`, { limit: 5, windowSeconds: 3600 });
    if (!byEmail.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many codes sent to this email. Try again later." },
        { status: 429, headers: { "Retry-After": String(byEmail.retryAfterSeconds) } }
      );
    }

    if (await isEmailRegistered(body.email)) {
      return NextResponse.json(
        { ok: false, error: "An account with this email already exists. Sign in instead.", code: "EMAIL_TAKEN" },
        { status: 409 }
      );
    }

    const { code, expiresInSeconds } = await issueEmailCode(body.email, "signup");
    const delivery = await deliverEmailCode(body.email, code, "signup");
    if (!delivery.ok) {
      return NextResponse.json({ ok: false, error: delivery.error, code: "EMAIL_SEND_FAILED" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, expiresInSeconds, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 429 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" }, { status: 400 });
    }
    console.error("[auth/signup/start]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
