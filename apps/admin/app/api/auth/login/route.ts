import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, loginUser } from "@gumakart/auth";
import { resolveSellerHomePath } from "@gumakart/db";
import { homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { signInJson } from "@/lib/two-factor-sign-in";

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
    const redirectTo = user.role === "partner" ? "/partner" : shopRole && shopRole !== "owner" ? homeFor(shopRole) : await resolveSellerHomePath({
      tenantId: user.tenantId,
      emailVerified: user.emailVerified,
      preferLaunchWhenUnverified: true,
    });

    // Phase 21: accounts with two-step sign-in get a code prompt instead of a session.
    return signInJson(user, sessionToken, { user, redirectTo });
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
