import { jwtVerify, SignJWT } from "jose";

/**
 * Phase 12 — Guma ID buyer session (storefront domain). A separate signing key from the
 * seller and POS cookies, so none can be read as another. Key: GUMA_ID_SECRET, else
 * AUTH_SECRET (both ≥ 32 chars); local dev falls back to a fixed dev key.
 */

export const BUYER_COOKIE = "gk_buyer";
export const BUYER_MAX_AGE = 90 * 24 * 60 * 60;

function rawSecret(): string | null {
  const s = process.env.GUMA_ID_SECRET ?? process.env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "dev-only-gumakart-auth-secret-min-32-chars" : undefined);
  return s && s.length >= 32 ? s : null;
}

/** True when buyer sessions can be signed (the secret is set). */
export function buyerSessionsConfigured(): boolean {
  return rawSecret() !== null;
}

/** Secret for hashing OTP codes (derived, never the raw session key). */
export function buyerOtpSecret(): string {
  const s = rawSecret();
  if (!s) throw new Error("GUMA_ID_SECRET (or AUTH_SECRET) is missing.");
  return `${s}:gumakart-buyer-otp-v1`;
}

function key(): Uint8Array {
  const s = rawSecret();
  if (!s) throw new Error("GUMA_ID_SECRET (or AUTH_SECRET) is missing.");
  return new TextEncoder().encode(`${s}:gumakart-buyer-v1`);
}

export interface BuyerClaims {
  buyerId: string;
  sessionVersion: number;
}

export async function createBuyerToken(claims: BuyerClaims): Promise<string> {
  return new SignJWT({ v: claims.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("gk-buyer")
    .setSubject(claims.buyerId)
    .setIssuedAt()
    .setExpirationTime(`${BUYER_MAX_AGE}s`)
    .sign(key());
}

export async function verifyBuyerToken(token: string | null | undefined): Promise<BuyerClaims | null> {
  if (!token || !rawSecret()) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "gk-buyer" });
    return typeof payload.sub === "string" && typeof payload.v === "number" ? { buyerId: payload.sub, sessionVersion: payload.v } : null;
  } catch {
    return null;
  }
}
