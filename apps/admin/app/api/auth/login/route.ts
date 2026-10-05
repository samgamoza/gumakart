import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, loginUser, sessionCookieHeader } from "@gumakart/auth";
import { resolveSellerHomePath } from "@gumakart/db";
import { homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`login:${clientIpFrom(request)}`, {
      limit: 10,
      windowSeconds: 300,
    });
    if (!limited.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many login attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }

    const body = loginSchema.parse(await request.json());
    const { user, sessionToken } = await loginUser(body);

    const shopRole = shopRoleOf(user);
    const redirectTo = shopRole && shopRole !== "owner" ? homeFor(shopRole) : await resolveSellerHomePath({
      tenantId: user.tenantId,
      emailVerified: user.emailVerified,
      preferLaunchWhenUnverified: true,
    });

    const response = NextResponse.json({
      ok: true,
      user,
      redirectTo,
    });

    response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 400 });
    }
    console.error("[auth/login]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
