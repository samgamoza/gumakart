import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, createSignupTicket, verifyEmailCode } from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const schema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(6).max(12),
});

/** Step 2 of signup: check the emailed code and hand back a signup ticket. */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`signup-verify:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 600 });
    if (!limited.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }
    const body = schema.parse(await request.json());
    await verifyEmailCode(body.email, "signup", body.code);
    const ticket = await createSignupTicket(body.email);
    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Enter the 6-digit code from the email.", code: "VALIDATION" }, { status: 400 });
    }
    console.error("[auth/signup/verify]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
