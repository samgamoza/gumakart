import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, users } from "@gumakart/db";
import {
  clearSessionCookieHeader,
  createMfaTicket,
  hasTwoFactor,
  mfaTicketCookieHeader,
  verifyPassword,
} from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Ops sign-in, step 1 of 2 (Phase 21). A correct password never yields a session on its own:
 * it sets a 5-minute 2FA ticket cookie, and the next step is either the authenticator code
 * ("verify") or — for an admin who hasn't set it up yet — enrollment ("enroll").
 */
export async function POST(request: Request) {
  try {
    const byIp = await rateLimit(`ops-login:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 300 });
    if (!byIp.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many sign-in attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(byIp.retryAfterSeconds) } }
      );
    }
    const { email, password } = loginSchema.parse(await request.json());
    const normalizedEmail = email.trim().toLowerCase();
    const byEmail = await rateLimit(`ops-login-email:${normalizedEmail}`, { limit: 10, windowSeconds: 900 });
    if (!byEmail.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many sign-in attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(byEmail.retryAfterSeconds) } }
      );
    }

    const [user] = await getDb().select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const invalid = () => NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });

    // Same answer for "no such account", "not an admin" and "wrong password" — the ops login
    // shouldn't confirm which emails are admins.
    if (!user?.passwordHash) return invalid();
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid || user.role !== "super_admin") return invalid();
    if (user.status !== "active") {
      return NextResponse.json({ ok: false, error: "This account is suspended." }, { status: 403 });
    }

    const kind = (await hasTwoFactor(user.id)) ? "verify" : "enroll";
    const ticket = await createMfaTicket({ userId: user.id, sessionVersion: user.sessionVersion ?? 0, app: "ops", kind });
    const response = NextResponse.json({ ok: true, step: kind });
    response.headers.set("Set-Cookie", mfaTicketCookieHeader(ticket));
    response.headers.append("Set-Cookie", clearSessionCookieHeader());
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 400 });
    }
    console.error("[platform/auth/login]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
