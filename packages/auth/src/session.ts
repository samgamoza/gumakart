import { SignJWT, jwtVerify } from "jose";
import {
  AUTH_COOKIE_NAME,
  EMAIL_VERIFY_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS,
  PARTNER_ACCESS_SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
  type SessionUser,
} from "./types";

export {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  EMAIL_VERIFY_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS,
  SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS,
};
export type { SessionPayload, SessionUser };

function getAuthSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development"
      ? "dev-only-gumakart-auth-secret-min-32-chars"
      : undefined);
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set a random string of at least 32 characters in .env"
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  user: SessionUser,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const age = user.supportAccess
    ? Math.min(maxAgeSeconds, SUPPORT_ACCESS_SESSION_MAX_AGE_SECONDS)
    : user.partnerAccess
      ? Math.min(maxAgeSeconds, PARTNER_ACCESS_SESSION_MAX_AGE_SECONDS)
      : maxAgeSeconds;

  return new SignJWT({
    email: user.email,
    role: user.role,
    ...(user.staffRole ? { sr: user.staffRole } : {}),
    tenantId: user.tenantId,
    tenantSlug: user.tenantSlug,
    tenantName: user.tenantName,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    needsShopSetup: user.needsShopSetup,
    sv: user.sessionVersion,
    ...(user.supportAccess ? { sa: true } : {}),
    ...(user.partnerAccess ? { pa: user.partnerAccess } : {}),
    ...(user.mfa ? { mf: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${age}s`)
    .sign(getAuthSecret());
}

export async function createEmailVerificationToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ purpose: "email_verify", email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${EMAIL_VERIFY_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret());
}

export type SupportAccessGrant = {
  actorUserId: string;
  actorEmail: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
};

/** What a verified grant carries back, including the one-shot id the exchange route records (GK-9). */
export type VerifiedSupportAccessGrant = SupportAccessGrant & { jti: string; expiresAt: Date };

/** Short-lived token — exchanged on admin.* so the cookie is set on that host. */
export async function createSupportAccessGrantToken(
  input: SupportAccessGrant
): Promise<string> {
  return new SignJWT({
    purpose: "support_access",
    email: input.actorEmail,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    tenantName: input.tenantName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.actorUserId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SUPPORT_ACCESS_GRANT_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret());
}

export async function verifySupportAccessGrantToken(
  token: string
): Promise<VerifiedSupportAccessGrant | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (payload.purpose !== "support_access") return null;
    if (typeof payload.jti !== "string" || typeof payload.exp !== "number") return null;
    const actorUserId = payload.sub;
    const actorEmail = payload.email;
    const tenantId = payload.tenantId;
    const tenantSlug = payload.tenantSlug;
    const tenantName = payload.tenantName;
    if (
      typeof actorUserId !== "string" ||
      typeof actorEmail !== "string" ||
      typeof tenantId !== "string" ||
      typeof tenantSlug !== "string" ||
      typeof tenantName !== "string"
    ) {
      return null;
    }
    return { actorUserId, actorEmail, tenantId, tenantSlug, tenantName, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    // Purpose tokens (email verify, support grant, 2FA ticket) are never sessions.
    if (payload.purpose !== undefined) return null;
    const userId = payload.sub;
    if (!userId || typeof userId !== "string") return null;

    const email = payload.email;
    const role = payload.role;
    const tenantId = payload.tenantId;
    const tenantSlug = payload.tenantSlug;
    const tenantName = payload.tenantName;
    const displayName = payload.displayName;
    const emailVerified = payload.emailVerified;
    const needsShopSetup = payload.needsShopSetup;

    if (
      typeof email !== "string" ||
      typeof role !== "string" ||
      (tenantId !== null && tenantId !== undefined && typeof tenantId !== "string") ||
      (tenantSlug !== null && tenantSlug !== undefined && typeof tenantSlug !== "string") ||
      (tenantName !== null && tenantName !== undefined && typeof tenantName !== "string") ||
      typeof displayName !== "string" ||
      typeof emailVerified !== "boolean"
    ) {
      return null;
    }

    const resolvedTenantId = typeof tenantId === "string" ? tenantId : null;
    const resolvedTenantSlug = typeof tenantSlug === "string" ? tenantSlug : null;
    const resolvedTenantName = typeof tenantName === "string" ? tenantName : null;
    const resolvedNeedsShopSetup =
      typeof needsShopSetup === "boolean" ? needsShopSetup : !resolvedTenantId;

    return {
      userId,
      email,
      role,
      staffRole: typeof payload.sr === "string" ? payload.sr : null,
      tenantId: resolvedTenantId,
      tenantSlug: resolvedTenantSlug,
      tenantName: resolvedTenantName,
      displayName,
      emailVerified,
      needsShopSetup: resolvedNeedsShopSetup,
      sessionVersion: typeof payload.sv === "number" ? payload.sv : 0,
      supportAccess: payload.sa === true,
      partnerAccess: typeof payload.pa === "string" ? payload.pa : null,
      mfa: payload.mf === true,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export async function verifyEmailToken(
  token: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (payload.purpose !== "email_verify") return null;
    const userId = payload.sub;
    const email = payload.email;
    if (!userId || typeof userId !== "string" || typeof email !== "string") return null;
    return { userId, email };
  } catch {
    return null;
  }
}

function cookieSecureFlag(): boolean {
  // LAN / HTTP soft-launch: set AUTH_COOKIE_SECURE=false so browsers keep the session.
  // Default: Secure in production (HTTPS), off in development.
  const override = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "false" || override === "0") return false;
  if (override === "true" || override === "1") return true;
  return process.env.NODE_ENV === "production";
}

export function getSessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: cookieSecureFlag(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieHeader(token: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  const opts = getSessionCookieOptions(maxAge);
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
