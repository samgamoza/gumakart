import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createSessionToken,
  getSessionFromRequest,
  getUserSessionById,
  issueEmailCode,
  markUserEmailVerified,
  sessionCookieHeader,
  verifyEmailCode,
} from "@gumakart/auth";
import { resolveSellerHomePath } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { deliverEmailCode } from "@/lib/email-code-mailer";

const schema = z.union([
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("verify"), code: z.string().trim().min(6).max(12) }),
]);

/**
 * Verification for accounts that exist but haven't confirmed their email
 * (older signups). Signed-in only: "send" emails a code, "verify" checks it,
 * stamps email_verified_at and re-issues the session cookie.
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }
    const user = await getUserSessionById(session.userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
    }

    const body = schema.parse(await request.json());

    if (user.emailVerified) {
      const redirectTo = await resolveSellerHomePath({ tenantId: user.tenantId, emailVerified: true });
      const response = NextResponse.json({ ok: true, verified: true, redirectTo });
      response.headers.set("Set-Cookie", sessionCookieHeader(await createSessionToken(user)));
      return response;
    }

    if (body.action === "send") {
      const limited = await rateLimit(`verify-code:${user.userId}`, { limit: 5, windowSeconds: 3600 });
      if (!limited.allowed) {
        return NextResponse.json({ ok: false, error: "Too many codes requested. Try again later." }, { status: 429 });
      }
      const { code, expiresInSeconds } = await issueEmailCode(user.email, "verify");
      const delivery = await deliverEmailCode(user.email, code, "verify");
      if (!delivery.ok) {
        return NextResponse.json({ ok: false, error: delivery.error }, { status: 503 });
      }
      return NextResponse.json({ ok: true, sentTo: user.email, expiresInSeconds, ...(delivery.devCode ? { devCode: delivery.devCode } : {}) });
    }

    const limited = await rateLimit(`verify-check:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 600 });
    if (!limited.allowed) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    }
    await verifyEmailCode(user.email, "verify", body.code);
    const verified = await markUserEmailVerified(user.userId);
    if (!verified) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
    }
    const redirectTo = await resolveSellerHomePath({ tenantId: verified.tenantId, emailVerified: true });
    const response = NextResponse.json({ ok: true, verified: true, redirectTo });
    response.headers.set("Set-Cookie", sessionCookieHeader(await createSessionToken(verified)));
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Enter the 6-digit code from the email." }, { status: 400 });
    }
    console.error("[auth/verify-email/code]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
