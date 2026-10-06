import { NextResponse } from "next/server";
import {
  AuthError,
  authenticateGoogleUser,
  getGoogleProfileFromCode,
  isGoogleAuthConfigured,
} from "@gumakart/auth";
import { signInRedirect } from "@/lib/two-factor-sign-in";
import {
  clearGoogleOAuthStateCookieHeader,
  parseGoogleOAuthState,
  readGoogleOAuthStateCookie,
} from "@/lib/google-oauth-state";

export async function GET(request: Request) {
  if (!isGoogleAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = readGoogleOAuthStateCookie(request);

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_oauth_state", request.url));
  }

  const parsedState = parseGoogleOAuthState(state);
  if (!parsedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_oauth_state", request.url));
  }

  try {
    const profile = await getGoogleProfileFromCode(code);
    const { user, sessionToken, redirectTo } = await authenticateGoogleUser(profile);

    // Phase 21: Google proves the first step only; two-step accounts still need their code.
    const response = await signInRedirect(request, user, sessionToken, redirectTo);
    response.headers.append("Set-Cookie", clearGoogleOAuthStateCookieHeader());
    return response;
  } catch (err) {
    const message =
      err instanceof AuthError
        ? err.message
        : err instanceof Error
          ? err.message
          : "google_auth_failed";

    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
