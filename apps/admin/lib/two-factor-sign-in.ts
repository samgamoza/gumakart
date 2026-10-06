import { NextResponse } from "next/server";
import {
  clearSessionCookieHeader,
  createMfaTicket,
  hasTwoFactor,
  mfaTicketCookieHeader,
  sessionCookieHeader,
  type SessionUser,
} from "@gumakart/auth";

/**
 * Phase 21: the last step of every seller-side sign-in (password, Google, password reset).
 * Accounts with two-step sign-in get a 5-minute 2FA ticket cookie instead of a session; the
 * login page then asks for the authenticator code (/api/auth/2fa/verify swaps it for a session).
 */
export async function needsSecondStep(user: SessionUser, next: string): Promise<string | null> {
  if (!(await hasTwoFactor(user.userId))) return null;
  // The destination rides inside the signed ticket (never taken from the client afterwards).
  const ticket = await createMfaTicket({ userId: user.userId, sessionVersion: user.sessionVersion, app: "admin", kind: "verify", next });
  return mfaTicketCookieHeader(ticket);
}

/** JSON flavour (login form, reset form). `body` is what a normal sign-in would return. */
export async function signInJson(user: SessionUser, sessionToken: string, body: Record<string, unknown> & { redirectTo: string }) {
  const ticket = await needsSecondStep(user, body.redirectTo);
  if (ticket) {
    const response = NextResponse.json({ ok: true, twoFactor: true, ...("passwordChanged" in body ? { passwordChanged: true } : {}) });
    response.headers.set("Set-Cookie", ticket);
    response.headers.append("Set-Cookie", clearSessionCookieHeader());
    return response;
  }
  const response = NextResponse.json({ ok: true, ...body });
  response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
  return response;
}

/** Redirect flavour (Google callback). */
export async function signInRedirect(request: Request, user: SessionUser, sessionToken: string, redirectTo: string) {
  const ticket = await needsSecondStep(user, redirectTo);
  if (ticket) {
    const response = NextResponse.redirect(new URL("/login?step=2fa", request.url));
    response.headers.set("Set-Cookie", ticket);
    response.headers.append("Set-Cookie", clearSessionCookieHeader());
    return response;
  }
  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
  return response;
}
