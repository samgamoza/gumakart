import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  readSessionCookie,
  verifySessionToken,
} from "@gumakart/auth/session";

const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/auth/session", "/api/auth/2fa/"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
  // Phase 21: an ops session must have passed the two-step check. Pages and actions also check
  // the session version against the database (lib/session.ts); this is the cheap edge filter.
  const isSuperAdmin = session?.role === "super_admin" && session.mfa === true;
  const isPublic = isPublicPath(pathname);

  if (isPublic) {
    if (isSuperAdmin && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!isSuperAdmin) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Super-admin access required." },
        { status: 401 }
      );
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
