import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, readSessionCookie, verifySessionToken } from "@gumakart/auth/session";
import { canOpenPage, homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";

// "/pos" is reachable by cashiers who only have a POS PIN cookie (no seller
// session); every /api/pos route checks the owner session or that cookie itself.
const PUBLIC_PATHS = ["/login", "/signup", "/verify-email", "/kyc/mobile", "/pos", "/invite", "/partners/join", "/forgot-password"];

const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/verify-email",
  "/api/auth/check-slug",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/session",
  // Platform → admin Support access grant exchange (sets admin-host cookie).
  "/api/auth/support-access",
  "/api/auth/exit-support",
  // Mobile KYC flow uses a signed session token instead of a login cookie.
  "/api/kyc/session",
  "/api/kyc/upload",
  "/api/kyc/submit",
  "/api/kyc/document/",
  // Cron requests carry a Bearer CRON_SECRET, not a session cookie.
  // Each cron route validates the secret itself.
  "/api/cron/",
  // Inngest cloud / Dev Server — signed with INNGEST_SIGNING_KEY.
  "/api/inngest",
  // POS Lite: owner session OR cashier PIN cookie, checked in each route (lib/pos-auth).
  "/api/pos/",
  // Staff invites: the token in the link is the credential (checked in the route).
  "/api/invite",
  // Phase 13: Meta webhook — signed with META_APP_SECRET (checked in the route).
  "/api/webhooks/meta",
  // Phase 15: public REST API — a shop API key (Bearer gk_live_…) checked in each route
  // (lib/public-api withApi). Never a session cookie.
  "/api/v1/",
  // Phase 18: partner signup and the public "who is this partner code" lookup.
  "/api/partners/signup",
  "/api/partners/code",
  // Phase 19: forgot password (the emailed code is the credential).
  "/api/auth/password/",
  "/api/auth/2fa/",
  // Phase 19: schema check for the CI pre-deploy guard (booleans only).
  "/api/health/schema",
];

/** Phase 18: what a partner's own session (no shop) may open. */
const PARTNER_PATHS = ["/partner", "/api/partner", "/api/auth/logout", "/api/auth/session", "/api/account/two-factor"];

function isPartnerPath(pathname: string): boolean {
  return PARTNER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const SHOP_SETUP_PATHS = ["/signup/shop", "/api/auth/google/complete-shop", "/api/auth/logout"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const VERIFY_PATHS = ["/verify-email", "/api/auth/verify-email", "/api/auth/logout", "/api/auth/session"];

function isVerifyPath(pathname: string): boolean {
  return VERIFY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isShopSetupPath(pathname: string): boolean {
  return SHOP_SETUP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Phase 10: the API guard in requireTenantSession needs the request path and method.
 * Set them here on EVERY request that continues, overwriting anything the client sent,
 * so a staff member can't claim to be calling a different endpoint.
 */
function pass(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-guma-path", request.nextUrl.pathname);
  headers.set("x-guma-method", request.method);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/brand/") ||
    // Phase 12b: the register's offline service worker (cashiers have no seller session).
    pathname === "/pos-sw.js" ||
    /\.(ico|png|jpe?g|gif|webp|avif|svg|txt|xml|webmanifest)$/.test(pathname)
  ) {
    return pass(request);
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? readSessionCookie(request);
  const session = token ? await verifySessionToken(token) : null;
  const isPublic = isPublicPath(pathname);

  // Platform admins (no shop) must not use the seller app — their cookie is shared
  // with the Platform Console and lacks tenantId.
  if (session?.role === "super_admin" && !session.tenantId) {
    if (!isPublic) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "error",
        "Platform admin accounts cannot manage a shop here. Sign in with a seller account, or use the Platform Console."
      );
      return NextResponse.redirect(loginUrl);
    }
    return pass(request);
  }

  // Phase 18: a partner's own session only reaches the partner dashboard. (Inside a client
  // shop the JWT says seller_staff, so the staff page guard below applies instead.)
  if (session?.role === "partner") {
    if (pathname === "/login" || pathname === "/signup" || pathname === "/") {
      return NextResponse.redirect(new URL("/partner", request.url));
    }
    if (isPartnerPath(pathname) || isPublic) return pass(request);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Open a client shop first.", code: "PARTNER_NO_SHOP" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/partner", request.url));
  }

  // Only redirect to shop setup when the account truly has no tenant yet.
  if (session?.needsShopSetup && !session.tenantId) {
    if (isShopSetupPath(pathname)) {
      return pass(request);
    }
    return NextResponse.redirect(new URL("/signup/shop", request.url));
  }

  // Signed in but email not confirmed yet (older accounts): confirm before anything else.
  if (session && !session.emailVerified && !session.supportAccess && !isPublic && !isVerifyPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Confirm your email first.", code: "EMAIL_UNVERIFIED" },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  if (isPublic) {
    if (session && (pathname === "/login" || pathname === "/signup")) {
      return NextResponse.redirect(new URL("/launch", request.url));
    }
    return pass(request);
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Phase 10: staff only see the pages their role allows (the API checks again
  // against the database, so this is navigation, not the security boundary).
  if (session.role === "seller_staff" && !pathname.startsWith("/api/")) {
    const role = shopRoleOf(session);
    if (!canOpenPage(role, pathname)) {
      const home = homeFor(role);
      if (pathname !== home) return NextResponse.redirect(new URL(home, request.url));
    }
  }

  return pass(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
