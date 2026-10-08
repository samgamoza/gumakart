import { NextResponse } from "next/server";
import {
  SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  getUserSessionById,
  sessionCookieHeader,
  verifySupportAccessGrantToken,
} from "@gumakart/auth";
import { consumeTokenOnce, getTenantStatusById } from "@gumakart/db";

/**
 * Exchange a short-lived Platform grant for an admin-host session cookie.
 * Cookie is host-only (admin.*) — ops.* session is unchanged.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=Missing+support+access+token", request.url));
  }

  const grant = await verifySupportAccessGrantToken(token);
  if (!grant) {
    return NextResponse.redirect(
      new URL("/login?error=Support+access+link+expired.+Open+the+shop+again+from+Platform.", request.url)
    );
  }

  // Security G1 (GK-9): a grant opens exactly one session. The link in the browser
  // history or a log is spent the moment it is used.
  if (!(await consumeTokenOnce(grant.jti, "support_access", grant.expiresAt))) {
    return NextResponse.redirect(
      new URL("/login?error=This+support+access+link+was+already+used.+Open+the+shop+again+from+Platform.", request.url)
    );
  }

  const actor = await getUserSessionById(grant.actorUserId);
  if (!actor || actor.role !== "super_admin") {
    return NextResponse.redirect(
      new URL("/login?error=Support+access+requires+a+platform+admin+account.", request.url)
    );
  }

  const tenantStatus = await getTenantStatusById(grant.tenantId);
  if (tenantStatus == null) {
    return NextResponse.redirect(new URL("/login?error=Shop+not+found.", request.url));
  }

  const sessionToken = await createSessionToken(
    {
      userId: actor.userId,
      email: actor.email,
      role: "super_admin",
      tenantId: grant.tenantId,
      tenantSlug: grant.tenantSlug,
      tenantName: grant.tenantName,
      displayName: actor.displayName,
      emailVerified: actor.emailVerified,
      needsShopSetup: false,
      sessionVersion: actor.sessionVersion,
      supportAccess: true,
    },
    SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS
  );

  const dest = new URL("/", request.url);
  dest.searchParams.set("support", "1");
  const response = NextResponse.redirect(dest);
  response.headers.set(
    "Set-Cookie",
    sessionCookieHeader(sessionToken, SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS)
  );
  return response;
}
