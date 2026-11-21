/**
 * AI suite Phase 5 — short-lived HS256 tokens between Guma ecosystem apps (kart → Printair).
 * Secret: GUMA_ECOSYSTEM_JWT_SECRET (same value on both apps). Web Crypto only, so it runs on
 * Cloudflare Workers and Node alike.
 */
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface EcosystemClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

export class EcosystemJwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcosystemJwtError";
  }
}

export function ecosystemJwtSecret(): string | null {
  const s = process.env.GUMA_ECOSYSTEM_JWT_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

export async function signEcosystemJwt(
  claims: { iss: string; aud: string; sub: string; [key: string]: unknown },
  secret: string,
  opts: { ttlSeconds?: number; now?: Date } = {}
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  if (secret.length < 32) throw new EcosystemJwtError("GUMA_ECOSYSTEM_JWT_SECRET must be at least 32 characters");
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = iat + Math.max(30, Math.min(opts.ttlSeconds ?? 300, 900));
  const jti = crypto.randomUUID();
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({ ...claims, iat, exp, jti })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${header}.${payload}`)));
  return { token: `${header}.${payload}.${b64url(sig)}`, jti, expiresAt: new Date(exp * 1000) };
}

/** Reference verifier (what Printair's /api/import-from-gumakart must do). */
export async function verifyEcosystemJwt(token: string, secret: string, expect: { aud: string; iss?: string; now?: Date }): Promise<EcosystemClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new EcosystemJwtError("malformed token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  } catch {
    throw new EcosystemJwtError("malformed token");
  }
  if (header.alg !== "HS256") throw new EcosystemJwtError("unexpected algorithm");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new EcosystemJwtError("bad signature");
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p))) as EcosystemClaims;
  const now = Math.floor((expect.now ?? new Date()).getTime() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) throw new EcosystemJwtError("token expired");
  if (typeof claims.iat === "number" && claims.iat > now + 60) throw new EcosystemJwtError("token from the future");
  if (claims.aud !== expect.aud) throw new EcosystemJwtError("wrong audience");
  if (expect.iss && claims.iss !== expect.iss) throw new EcosystemJwtError("wrong issuer");
  return claims;
}
