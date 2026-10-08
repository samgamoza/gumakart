import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, loginUser } from "@gumakart/auth";
import { recordAuditEvent, resolveSellerHomePath } from "@gumakart/db";
import { homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";
import { clientIpFrom, limiterSubject, rateLimit, rateLimitBlocked } from "@gumakart/services";
import { signInJson } from "@/lib/two-factor-sign-in";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Per-account lock (GK-2): 8 wrong passwords in 15 minutes locks that email, whatever the IP. */
const ACCOUNT_LOCK = { limit: 8, windowSeconds: 900 };

export async function POST(request: Request) {
  let lockKey: string | null = null;
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
    lockKey = `login-fail:${await limiterSubject(body.email)}`;
    const locked = await rateLimitBlocked(lockKey, ACCOUNT_LOCK);
    if (!locked.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many wrong passwords for this account. Try again in a few minutes or reset your password." },
        { status: 429, headers: { "Retry-After": String(locked.retryAfterSeconds) } }
      );
    }
    const { user, sessionToken } = await loginUser(body);
    // Security G3 (GK-20): sign-ins are in the audit chain.
    await recordAuditEvent({ tenantId: user.tenantId ?? null, actorId: user.userId, actorLabel: user.email, action: "auth.login", entityType: "user", entityId: user.userId, details: { ip: clientIpFrom(request), role: user.role } });

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
      if (lockKey && error.code === "INVALID_CREDENTIALS") await rateLimit(lockKey, ACCOUNT_LOCK);
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 400 });
    }
    console.error("[auth/login]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
