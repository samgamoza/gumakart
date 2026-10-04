import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, readSessionCookie, verifySessionToken } from "@gumakart/auth/session";

// "/pos" is reachable by cashiers who only have a POS PIN cookie (no seller
// session); every /api/pos route checks the owner session or that cookie itself.
const PUBLIC_PATHS = ["/login", "/signup", "/verify-email", "/kyc/mobile", "/pos"];

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
];

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/brand/") ||
    /\.(ico|png|jpe?g|gif|webp|avif|svg|txt|xml|webmanifest)$/.test(pathname)
  ) {
    return NextResponse.next();
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
    return NextResponse.next();
  }

  // Only redirect to shop setup when the account truly has no tenant yet.
  if (session?.needsShopSetup && !session.tenantId) {
    if (isShopSetupPath(pathname)) {
      return NextResponse.next();
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
    return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
