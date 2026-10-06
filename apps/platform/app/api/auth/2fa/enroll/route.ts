import QRCode from "qrcode";
import { z } from "zod";
import { AuthError, beginTwoFactorEnrollment, confirmTwoFactorEnrollment } from "@gumakart/auth";
import { NextResponse } from "next/server";
import { OPS_TOTP_ISSUER, codeAttemptsLeft, currentOpsTicket, jsonError, opsSessionResponse } from "@/lib/ops-sign-in";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), code: z.string().trim().min(6).max(12) }),
]);

/**
 * Ops sign-in for an admin without 2FA yet: required setup (Phase 21).
 * "start" → a new secret + QR; "confirm" with a code from the app → backup codes + session.
 * Only reachable with an "enroll" ticket, i.e. right after a correct password.
 */
export async function POST(request: Request) {
  try {
    const ticket = await currentOpsTicket(request);
    if (!ticket || ticket.kind !== "enroll") return jsonError("Your sign-in expired. Enter your password again.", 401);
    const body = schema.parse(await request.json());

    if (body.action === "start") {
      const { secret, otpauthUri } = await beginTwoFactorEnrollment(ticket.userId, OPS_TOTP_ISSUER);
      const qrSvg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return NextResponse.json({ ok: true, secret, otpauthUri, qrSvg });
    }

    const wait = await codeAttemptsLeft(request, ticket.userId);
    if (wait !== null) return jsonError("Too many tries. Wait a few minutes, then sign in again.", 429, { "Retry-After": String(wait) });
    const { backupCodes } = await confirmTwoFactorEnrollment(ticket.userId, body.code);
    return opsSessionResponse(ticket.userId, { backupCodes }, { action: "ops_2fa_enrolled" });
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, 400);
    if (error instanceof z.ZodError) return jsonError("Enter the 6-digit code from your app.", 400);
    console.error("[platform/auth/2fa/enroll]", error);
    return jsonError("Something went wrong.", 500);
  }
}
