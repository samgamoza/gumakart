import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createEmailVerificationToken,
  createSessionToken,
  getUserSessionById,
  hasTwoFactor,
  sendVerificationEmail,
  sessionCookieHeader,
  verifyUserEmail,
} from "@gumakart/auth";
import { getSessionFromRequest } from "@gumakart/auth";
import { resolveSellerHomePath } from "@gumakart/db";

const bodySchema = z.object({
  token: z.string().min(10).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { token } = bodySchema.parse(json);

    if (token) {
      const user = await verifyUserEmail(token);
      if (!user) {
        return NextResponse.json(
          { ok: false, error: "This verification link is invalid or expired." },
          { status: 400 }
        );
      }

      // Phase 21: an email link is not a second factor — two-step accounts sign in normally.
      if (await hasTwoFactor(user.userId)) {
        return NextResponse.json({ ok: true, user, redirectTo: "/login" });
      }
      const sessionToken = await createSessionToken(user);
      const redirectTo = await resolveSellerHomePath({
        tenantId: user.tenantId,
        emailVerified: true,
        preferLaunchWhenUnverified: true,
      });
      const response = NextResponse.json({ ok: true, user, redirectTo });
      response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
      return response;
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }

    const user = await getUserSessionById(session.userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
    }

    if (user.emailVerified) {
      return NextResponse.json({ ok: true, user, message: "Email already verified." });
    }

    const verificationToken = await createEmailVerificationToken(user.userId, user.email);
    await sendVerificationEmail(user.email, verificationToken);

    return NextResponse.json({ ok: true, message: "Verification email sent." });
  } catch (error) {
    console.error("[auth/verify-email]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
