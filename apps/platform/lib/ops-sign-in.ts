import { NextResponse } from "next/server";
import {
  clearMfaTicketCookieHeader,
  createSessionToken,
  getUserSessionById,
  readMfaTicket,
  readMfaTicketCookie,
  sessionCookieHeader,
  ticketUserIsCurrent,
  type MfaTicket,
} from "@gumakart/auth";
import { writeAudit } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";

/** Phase 21: the authenticator app shows this name next to the code. */
export const OPS_TOTP_ISSUER = "Guma Kart Ops";

export function jsonError(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

/** The 2FA ticket from the password step, still valid for a current, active super-admin. */
export async function currentOpsTicket(request: Request): Promise<MfaTicket | null> {
  const ticket = await readMfaTicket(readMfaTicketCookie(request), "ops");
  if (!ticket) return null;
  return (await ticketUserIsCurrent(ticket)) ? ticket : null;
}

/** 10 code tries per account per 15 minutes, 30 per IP. */
export async function codeAttemptsLeft(request: Request, userId: string) {
  const byUser = await rateLimit(`ops-2fa:${userId}`, { limit: 10, windowSeconds: 900 });
  const byIp = await rateLimit(`ops-2fa-ip:${clientIpFrom(request)}`, { limit: 30, windowSeconds: 900 });
  return byUser.allowed && byIp.allowed ? null : Math.max(byUser.retryAfterSeconds, byIp.retryAfterSeconds);
}

/** Swaps the ticket for a full ops session marked as two-step verified. */
export async function opsSessionResponse(userId: string, body: Record<string, unknown>, audit: { action: string; metadata?: Record<string, unknown> }) {
  const user = await getUserSessionById(userId);
  if (!user || user.role !== "super_admin") return jsonError("This account is not a platform administrator.", 403);
  const token = await createSessionToken({ ...user, needsShopSetup: false, mfa: true });
  await writeAudit({
    actorId: user.userId,
    actorEmail: user.email,
    action: audit.action,
    entityType: "user",
    entityId: user.userId,
    entityLabel: user.email,
    metadata: audit.metadata,
  }).catch((e) => console.error("[ops/2fa] audit", e));
  const response = NextResponse.json({ ok: true, redirectTo: "/", ...body });
  response.headers.set("Set-Cookie", sessionCookieHeader(token));
  response.headers.append("Set-Cookie", clearMfaTicketCookieHeader());
  return response;
}
