import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionFromRequest,
  getUserSessionById,
  isSessionCurrent,
  sessionCookieHeader,
  sessionTokenForUser,
} from "@gumakart/auth";
import { verifyPartnerAccess } from "@gumakart/db";

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

  // Phase 18: partner working in a client shop — keep the shop context while the grant holds;
  // once it's gone, drop back to the partner's own session (their dashboard).
  if (session.partnerAccess && session.tenantId) {
    if (!(await isSessionCurrent(session.userId, session.sessionVersion))) {
      return NextResponse.json({ ok: false, user: null }, { status: 401 });
    }
    const access = await verifyPartnerAccess(session.userId, session.partnerAccess, session.tenantId);
    if (access) {
      return NextResponse.json({
        ok: true,
        user: {
          userId: session.userId,
          email: session.email,
          role: "seller_staff",
          staffRole: access.role,
          tenantId: access.tenantId,
          tenantSlug: access.tenantSlug,
          tenantName: access.tenantName,
          displayName: session.displayName,
          emailVerified: session.emailVerified,
          needsShopSetup: false,
        },
        sellerReady: true,
        platformAdminNoShop: false,
        supportAccess: false,
        partnerAccess: { partnerName: access.partnerName, shopName: access.tenantName },
      });
    }
    const own = await sessionTokenForUser(session.userId);
    const response = NextResponse.json({ ok: true, user: null, partnerRevoked: true, redirectTo: "/partner" });
    if (own) response.headers.set("Set-Cookie", sessionCookieHeader(own.sessionToken));
    return response;
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
    // Never re-mint from a revoked token (logout everywhere / password change bumps the version).
    (await isSessionCurrent(session.userId, session.sessionVersion)) &&
    (fresh.tenantId !== session.tenantId ||
      fresh.tenantSlug !== session.tenantSlug ||
      fresh.needsShopSetup !== session.needsShopSetup)
  ) {
    const token = await createSessionToken(fresh);
    response.headers.set("Set-Cookie", sessionCookieHeader(token));
  }

  return response;
}
