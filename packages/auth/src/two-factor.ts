/**
 * Phase 21: two-step sign-in.
 *
 * - Ops super-admins must use it (enrollment is forced at their first sign-in).
 * - Sellers, staff and partners can turn it on in Settings → Account.
 *
 * Flow: password (or Google, or a password reset) proves step one → the server sets a short-lived
 * signed "2FA ticket" cookie instead of a session → the person enters an authenticator code or a
 * backup code → the ticket is exchanged for a real session. The ticket carries the session version,
 * so "sign out everywhere" also kills a half-finished sign-in.
 */
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, users } from "@gumakart/db";
import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  looksLikeBackupCode,
  matchTotp,
  openTotpSecret,
  otpauthUri,
  sealTotpSecret,
  totpStep,
} from "./totp";
import { AuthError, MFA_TICKET_MAX_AGE_SECONDS } from "./types";

export const MFA_TICKET_COOKIE = "gk_2fa";

export type MfaApp = "ops" | "admin";
/** "verify" = has 2FA, enter a code. "enroll" = ops admin without 2FA, must set it up first. */
export type MfaTicketKind = "verify" | "enroll";

export interface MfaTicket {
  userId: string;
  sessionVersion: number;
  app: MfaApp;
  kind: MfaTicketKind;
  /** Where to go after the code (admin only; validated as a same-site path). */
  next: string | null;
}

function ticketSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-only-gumakart-auth-secret-min-32-chars" : undefined);
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or too short.");
  return new TextEncoder().encode(secret);
}

function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next.slice(0, 300);
}

export async function createMfaTicket(input: Omit<MfaTicket, "next"> & { next?: string | null }): Promise<string> {
  return new SignJWT({
    purpose: "mfa",
    sv: input.sessionVersion,
    app: input.app,
    kind: input.kind,
    ...(safeNext(input.next) ? { next: safeNext(input.next) } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${MFA_TICKET_MAX_AGE_SECONDS}s`)
    .sign(ticketSecret());
}

export async function readMfaTicket(token: string | null | undefined, app: MfaApp): Promise<MfaTicket | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, ticketSecret());
    if (payload.purpose !== "mfa" || payload.app !== app) return null;
    if (typeof payload.sub !== "string" || typeof payload.sv !== "number") return null;
    if (payload.kind !== "verify" && payload.kind !== "enroll") return null;
    return {
      userId: payload.sub,
      sessionVersion: payload.sv,
      app,
      kind: payload.kind,
      next: typeof payload.next === "string" ? safeNext(payload.next) : null,
    };
  } catch {
    return null;
  }
}

function cookieSecure(): boolean {
  const o = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (o === "false" || o === "0") return false;
  if (o === "true" || o === "1") return true;
  return process.env.NODE_ENV === "production";
}

export function mfaTicketCookieHeader(ticket: string): string {
  const parts = [`${MFA_TICKET_COOKIE}=${encodeURIComponent(ticket)}`, "Path=/", `Max-Age=${MFA_TICKET_MAX_AGE_SECONDS}`, "HttpOnly", "SameSite=Lax"];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

export function clearMfaTicketCookieHeader(): string {
  return `${MFA_TICKET_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function readMfaTicketCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === MFA_TICKET_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// ─── status ──────────────────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  backupCodesLeft: number;
}

async function loadRow(userId: string) {
  const [row] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      sessionVersion: users.sessionVersion,
      totpSecretSealed: users.totpSecretSealed,
      totpEnabledAt: users.totpEnabledAt,
      totpLastStep: users.totpLastStep,
      totpBackupCodes: users.totpBackupCodes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const row = await loadRow(userId);
  const enabled = Boolean(row?.totpEnabledAt && row.totpSecretSealed);
  return { enabled, enabledAt: enabled ? row!.totpEnabledAt : null, backupCodesLeft: enabled ? (row!.totpBackupCodes ?? []).length : 0 };
}

/** True when signing in as this user needs the second step. */
export async function hasTwoFactor(userId: string): Promise<boolean> {
  return (await getTwoFactorStatus(userId)).enabled;
}

// ─── enrollment ──────────────────────────────────────────────────────────────

/**
 * Starts (or restarts) enrollment: a new secret is stored sealed but not active until a code from
 * the app confirms it. Refused when 2FA is already on — turn it off first, so a stolen session
 * can't silently swap the authenticator.
 */
export async function beginTwoFactorEnrollment(userId: string, issuer: string): Promise<{ secret: string; otpauthUri: string }> {
  const row = await loadRow(userId);
  if (!row) throw new AuthError("Account not found.", "INVALID_CREDENTIALS");
  if (row.totpEnabledAt) throw new AuthError("Two-step sign-in is already on.", "TWO_FACTOR_ON");
  const secret = generateTotpSecret();
  await getDb()
    .update(users)
    .set({ totpSecretSealed: await sealTotpSecret(secret), totpLastStep: null })
    .where(and(eq(users.id, userId), sql`${users.totpEnabledAt} IS NULL`));
  return { secret, otpauthUri: otpauthUri({ secret, account: row.email ?? userId, issuer }) };
}

/** Confirms enrollment with a code from the app. Returns the backup codes (shown once). */
export async function confirmTwoFactorEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  const row = await loadRow(userId);
  if (!row?.totpSecretSealed) throw new AuthError("Start the setup again.", "TWO_FACTOR_NOT_STARTED");
  if (row.totpEnabledAt) throw new AuthError("Two-step sign-in is already on.", "TWO_FACTOR_ON");
  const step = await matchTotp(await openTotpSecret(row.totpSecretSealed), code);
  if (step === null) throw new AuthError("That code didn't match. Check the time on your phone and try the newest code.", "BAD_CODE");
  const backupCodes = generateBackupCodes();
  const hashes = await Promise.all(backupCodes.map(hashBackupCode));
  const [done] = await getDb()
    .update(users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, totpBackupCodes: hashes })
    .where(and(eq(users.id, userId), sql`${users.totpEnabledAt} IS NULL`))
    .returning({ id: users.id });
  if (!done) throw new AuthError("Two-step sign-in is already on.", "TWO_FACTOR_ON");
  return { backupCodes };
}

// ─── checking a code ─────────────────────────────────────────────────────────

/**
 * Checks an authenticator code (once per 30-second step) or a backup code (once ever).
 * Both are claimed with a conditional UPDATE, so two requests racing with the same code can't
 * both win.
 */
export async function verifySecondFactor(userId: string, rawCode: string): Promise<{ method: "totp" | "backup"; backupCodesLeft: number }> {
  const row = await loadRow(userId);
  if (!row?.totpEnabledAt || !row.totpSecretSealed) throw new AuthError("Two-step sign-in isn't on for this account.", "TWO_FACTOR_OFF");
  const db = getDb();
  const codes = row.totpBackupCodes ?? [];

  if (looksLikeBackupCode(rawCode)) {
    const hash = await hashBackupCode(rawCode);
    if (!codes.includes(hash)) throw new AuthError("That code didn't work.", "BAD_CODE");
    const [left] = await db
      .update(users)
      .set({ totpBackupCodes: sql`${users.totpBackupCodes} - ${hash}::text` })
      .where(and(eq(users.id, userId), sql`${users.totpBackupCodes} ? ${hash}::text`))
      .returning({ codes: users.totpBackupCodes });
    if (!left) throw new AuthError("That code didn't work.", "BAD_CODE");
    return { method: "backup", backupCodesLeft: left.codes.length };
  }

  const step = await matchTotp(await openTotpSecret(row.totpSecretSealed), rawCode, { lastStep: row.totpLastStep });
  if (step === null) throw new AuthError("That code didn't work. Use the newest code in your authenticator app.", "BAD_CODE");
  const [claimed] = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), isNotNull(users.totpEnabledAt), sql`(${users.totpLastStep} IS NULL OR ${users.totpLastStep} < ${step})`))
    .returning({ id: users.id });
  if (!claimed) throw new AuthError("That code was already used. Wait for the next one.", "BAD_CODE");
  return { method: "totp", backupCodesLeft: codes.length };
}

/** New backup codes (the old ones stop working). Needs a current code. */
export async function regenerateBackupCodes(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  await verifySecondFactor(userId, code);
  const backupCodes = generateBackupCodes();
  await getDb()
    .update(users)
    .set({ totpBackupCodes: await Promise.all(backupCodes.map(hashBackupCode)) })
    .where(eq(users.id, userId));
  return { backupCodes };
}

/** Turns 2FA off (needs a current code). Ops callers must refuse this for super-admins. */
export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  await verifySecondFactor(userId, code);
  await resetTwoFactor(userId);
}

/** Clears 2FA with no code — for ops recovery and tests only, never from a seller request. */
export async function resetTwoFactor(userId: string): Promise<void> {
  await getDb()
    .update(users)
    .set({ totpSecretSealed: null, totpEnabledAt: null, totpLastStep: null, totpBackupCodes: [] })
    .where(eq(users.id, userId));
}

/**
 * The ticket → session check shared by both apps: the ticket is for this app, the account still
 * exists, is active, and nobody signed out everywhere since the password step.
 */
export async function ticketUserIsCurrent(ticket: MfaTicket): Promise<boolean> {
  const row = await loadRow(ticket.userId);
  if (!row || row.status !== "active") return false;
  if ((row.sessionVersion ?? 0) !== ticket.sessionVersion) return false;
  if (ticket.app === "ops" && row.role !== "super_admin") return false;
  return true;
}

export { totpStep };
