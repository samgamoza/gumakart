import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionFromRequest,
  getUserSessionById,
  sessionCookieHeader,
} from "@gumakart/auth";

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }

  // Support access: never overwrite JWT shop context with the admin's null tenant_id.
  if (session.supportAccess && session.role === "super_admin" && session.tenantId) {
    return NextResponse.json({
      ok: true,
      user: {
        userId: session.userId,
        email: session.email,
        role: session.role,
        tenantId: session.tenantId,
        tenantSlug: session.tenantSlug,
        tenantName: session.tenantName,
        displayName: session.displayName,
        emailVerified: session.emailVerified,
        needsShopSetup: false,
      },
      sellerReady: true,
      platformAdminNoShop: false,
      supportAccess: true,
    });
  }

  const fresh = await getUserSessionById(session.userId);
  const user = fresh ?? {
    userId: session.userId,
    email: session.email,
    role: session.role,
    tenantId: session.tenantId,
    tenantSlug: session.tenantSlug,
    tenantName: session.tenantName,
    displayName: session.displayName,
    emailVerified: session.emailVerified,
    needsShopSetup: session.needsShopSetup,
    sessionVersion: session.sessionVersion,
  };

  const response = NextResponse.json({
    ok: true,
    user: {
      userId: user.userId,
      email: user.email,
      role: user.role,
      staffRole: "staffRole" in user ? (user.staffRole ?? null) : null,
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      tenantName: user.tenantName,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      needsShopSetup: user.needsShopSetup,
    },
    sellerReady: Boolean(user.tenantId && user.tenantSlug),
    platformAdminNoShop: user.role === "super_admin" && !user.tenantId,
    supportAccess: false,
  });

  // Re-issue cookie when JWT tenant state is stale (e.g. after completing shop setup).
  if (
    fresh &&
    (fresh.tenantId !== session.tenantId ||
      fresh.tenantSlug !== session.tenantSlug ||
      fresh.needsShopSetup !== session.needsShopSetup)
  ) {
    const token = await createSessionToken(fresh);
    response.headers.set("Set-Cookie", sessionCookieHeader(token));
  }

  return response;
}
