import { NextResponse } from "next/server";
import { isSessionCurrent, sessionCookieHeader, sessionTokenForUser } from "@gumakart/auth";
import { getSession } from "@/lib/session";

/** Phase 18: leave a client shop — back to the partner's own session and dashboard. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, redirectTo: "/login" }, { status: 401 });
  // Never mint a fresh token from a revoked one (logout everywhere / password change).
  if (!(await isSessionCurrent(session.userId, session.sessionVersion))) {
    return NextResponse.json({ ok: false, redirectTo: "/login" }, { status: 401 });
  }
  const own = await sessionTokenForUser(session.userId);
  if (!own || own.user.role !== "partner") return NextResponse.json({ ok: false, redirectTo: "/" }, { status: 400 });
  const response = NextResponse.json({ ok: true, redirectTo: "/partner" });
  response.headers.set("Set-Cookie", sessionCookieHeader(own.sessionToken));
  return response;
}
