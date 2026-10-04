import { createLocalJWKSet, errors as joseErrors, jwtVerify } from "jose";
import type { GoogleProfile } from "./types";

/**
 * Google sign-in with plain fetch + jose.
 *
 * We used google-auth-library before, but it doesn't run on Cloudflare Workers:
 * its HTTP layer (gaxios) crashes there with "Cannot read properties of null
 * (reading 'has')" during the code exchange. These are the same two standard
 * OAuth calls without the library: exchange the code at Google's token endpoint,
 * then verify the ID token's signature against Google's published keys.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
type KeyResolver = Parameters<typeof jwtVerify>[1];

// Google's signing keys, fetched with plain fetch (same on Workers and Node) and
// kept for an hour; refetched once if a token names a key we don't have yet.
let cachedKeys: { resolver: KeyResolver; fetchedAt: number } | null = null;
let testKeys: KeyResolver | null = null;

async function googleKeys(forceRefresh = false): Promise<KeyResolver> {
  if (testKeys) return testKeys;
  if (!forceRefresh && cachedKeys && Date.now() - cachedKeys.fetchedAt < 60 * 60 * 1000) {
    return cachedKeys.resolver;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error("Couldn't reach Google to check the sign-in. Please try again.");
  const jwks = (await res.json()) as Parameters<typeof createLocalJWKSet>[0];
  cachedKeys = { resolver: createLocalJWKSet(jwks), fetchedAt: Date.now() };
  return cachedKeys.resolver;
}

/** Tests only: verify against local keys instead of Google's. */
export function setGoogleJwksForTests(keys: KeyResolver | null): void {
  testKeys = keys;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const GOOGLE_SCOPES = ["openid", "email", "profile"];

export function getGoogleRedirectUri(): string {
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
  return `${adminUrl}/api/auth/google/callback`;
}

function googleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for Google sign-in.");
  }
  return { clientId, clientSecret };
}

export function getGoogleAuthUrl(state: string): string {
  const { clientId } = googleCredentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function getGoogleProfileFromCode(code: string): Promise<GoogleProfile> {
  const { clientId, clientSecret } = googleCredentials();

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
  });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !tokens.id_token) {
    // e.g. invalid_grant (code already used / expired) — never echo secrets.
    throw new Error(
      tokens.error === "invalid_grant"
        ? "Google sign-in expired. Please try again."
        : "Google did not return an ID token."
    );
  }

  const verifyOptions = { issuer: GOOGLE_ISSUERS, audience: clientId };
  let payload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, await googleKeys(), verifyOptions));
  } catch (error) {
    // Google rotates keys; a token signed with a brand-new key needs a fresh key list.
    if (!(error instanceof joseErrors.JWKSNoMatchingKey)) throw error;
    ({ payload } = await jwtVerify(tokens.id_token, await googleKeys(true), verifyOptions));
  }

  const email = typeof payload.email === "string" ? payload.email : null;
  if (!payload.sub || !email) {
    throw new Error("Google profile is missing required fields.");
  }

  return {
    googleId: payload.sub,
    email: email.toLowerCase(),
    displayName: (typeof payload.name === "string" && payload.name) || email.split("@")[0] || "Seller",
    avatarUrl: typeof payload.picture === "string" ? payload.picture : undefined,
    emailVerified: payload.email_verified === true,
  };
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
