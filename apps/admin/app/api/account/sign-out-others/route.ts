import { NextResponse } from "next/server";
import { getSessionFromRequest, isSessionCurrent, sessionCookieHeader, signOutOtherDevices } from "@gumakart/auth";

/** Phase 21: Settings → Account → Sign out other devices (this one stays signed in). */
export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.supportAccess || !(await isSessionCurrent(session.userId, session.sessionVersion))) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const fresh = await signOutOtherDevices(session.userId);
  if (!fresh) return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookieHeader(fresh.sessionToken));
  return response;
}
