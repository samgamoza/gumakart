/**
 * Google sign-in without google-auth-library (it crashes on Cloudflare Workers).
 * Fake token endpoint + locally signed ID tokens; no network.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { getGoogleAuthUrl, getGoogleProfileFromCode, setGoogleJwksForTests } from "./google";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let tokenResponse: { status: number; body: unknown } = { status: 200, body: {} };
let lastTokenRequest: URLSearchParams | null = null;
let publicJwks: { keys: Array<Record<string, unknown>> } = { keys: [] };
let certFetches = 0;
const realFetch = globalThis.fetch;

async function idToken(claims: Record<string, unknown>, opts: { aud?: string; iss?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? CLIENT_ID)
    .setSubject("google-sub-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

before(async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_ADMIN_URL = "https://admin.guma.one";
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  publicJwks = { keys: [jwk] };
  setGoogleJwksForTests(createLocalJWKSet({ keys: [jwk] }));
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") {
      certFetches += 1;
      return new Response(JSON.stringify(publicJwks), { status: 200 });
    }
    assert.equal(String(url), "https://oauth2.googleapis.com/token");
    lastTokenRequest = new URLSearchParams(String(init?.body));
    return new Response(JSON.stringify(tokenResponse.body), { status: tokenResponse.status });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

describe("Google sign-in", () => {
  it("builds the consent URL with our client, callback and state", () => {
    const url = new URL(getGoogleAuthUrl("state-abc"));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), "https://admin.guma.one/api/auth/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "state-abc");
  });

  it("exchanges the code and returns the verified profile", async () => {
    tokenResponse = {
      status: 200,
      body: { id_token: await idToken({ email: "Ana@Example.com", email_verified: true, name: "Ana", picture: "https://x/p.png" }) },
    };
    const profile = await getGoogleProfileFromCode("the-code");
    assert.equal(lastTokenRequest?.get("code"), "the-code");
    assert.equal(lastTokenRequest?.get("grant_type"), "authorization_code");
    assert.equal(lastTokenRequest?.get("redirect_uri"), "https://admin.guma.one/api/auth/google/callback");
    assert.deepEqual(profile, {
      googleId: "google-sub-123",
      email: "ana@example.com",
      displayName: "Ana",
      avatarUrl: "https://x/p.png",
      emailVerified: true,
    });
  });

  it("rejects a token issued for another app or by someone else", async () => {
    tokenResponse = { status: 200, body: { id_token: await idToken({ email: "a@b.co" }, { aud: "someone-else" }) } };
    await assert.rejects(getGoogleProfileFromCode("c"));
    tokenResponse = { status: 200, body: { id_token: await idToken({ email: "a@b.co" }, { iss: "https://evil.example" }) } };
    await assert.rejects(getGoogleProfileFromCode("c"));
  });

  it("explains an expired or reused code", async () => {
    tokenResponse = { status: 400, body: { error: "invalid_grant" } };
    await assert.rejects(getGoogleProfileFromCode("old"), /expired/);
  });

  it("unverified Google emails are passed through as unverified", async () => {
    tokenResponse = { status: 200, body: { id_token: await idToken({ email: "x@y.co", email_verified: false }) } };
    const profile = await getGoogleProfileFromCode("c");
    assert.equal(profile.emailVerified, false);
  });

  it("fetches Google's keys with plain fetch and caches them", async () => {
    setGoogleJwksForTests(null);
    tokenResponse = { status: 200, body: { id_token: await idToken({ email: "k@y.co", email_verified: true }) } };
    await getGoogleProfileFromCode("c1");
    await getGoogleProfileFromCode("c2");
    assert.equal(certFetches, 1);
  });
});
