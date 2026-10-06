import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  clearMfaTicketCookieHeader,
  readMfaTicket,
  readMfaTicketCookie,
  sessionCookieHeader,
  sessionTokenForUser,
  ticketUserIsCurrent,
  verifySecondFactor,
} from "@gumakart/auth";
import { homeFor, shopRoleOf } from "@gumakart/db/staff-permissions";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const schema = z.object({ code: z.string().trim().min(6).max(20) });

/**
 * Phase 21: second sign-in step for sellers, staff and partners with two-step sign-in on.
 * The 2FA ticket cookie (set after the password / Google / reset step) is the credential;
 * code attempts are limited per account and per IP.
 */
export async function POST(request: Request) {
  try {
    const ticket = await readMfaTicket(readMfaTicketCookie(request), "admin");
    if (!ticket || !(await ticketUserIsCurrent(ticket))) {
      return NextResponse.json({ ok: false, error: "Your sign-in expired. Sign in again.", code: "TICKET_EXPIRED" }, { status: 401 });
    }
    const byUser = await rateLimit(`2fa:${ticket.userId}`, { limit: 10, windowSeconds: 900 });
    const byIp = await rateLimit(`2fa-ip:${clientIpFrom(request)}`, { limit: 30, windowSeconds: 900 });
    if (!byUser.allowed || !byIp.allowed) {
      return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes, then sign in again." }, { status: 429 });
    }
    const { code } = schema.parse(await request.json());
    const result = await verifySecondFactor(ticket.userId, code);
    const fresh = await sessionTokenForUser(ticket.userId);
    if (!fresh) return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
    const role = shopRoleOf(fresh.user);
    const fallback = fresh.user.role === "partner" ? "/partner" : role && role !== "owner" ? homeFor(role) : "/";
    const response = NextResponse.json({
      ok: true,
      redirectTo: ticket.next ?? fallback,
      ...(result.method === "backup" ? { backupCodesLeft: result.backupCodesLeft } : {}),
    });
    response.headers.set("Set-Cookie", sessionCookieHeader(fresh.sessionToken));
    response.headers.append("Set-Cookie", clearMfaTicketCookieHeader());
    return response;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Enter the 6-digit code from your app, or a backup code." }, { status: 400 });
    console.error("[auth/2fa/verify]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
