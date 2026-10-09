import QRCode from "qrcode";
import { z } from "zod";
import { AuthError, beginTwoFactorEnrollment, confirmTwoFactorEnrollment, getUserSessionById, issueEmailCode, verificationCodeEmail, verifyEmailCode } from "@gumakart/auth";
import { sendTransactionalEmail } from "@gumakart/services";
import { NextResponse } from "next/server";
import { OPS_TOTP_ISSUER, codeAttemptsLeft, currentOpsTicket, jsonError, opsSessionResponse } from "@/lib/ops-sign-in";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), code: z.string().trim().min(6).max(12), emailCode: z.string().trim().min(6).max(12) }),
]);

/**
 * Ops sign-in for an admin without 2FA yet: required setup (Phase 21).
 * "start" → a new secret + QR, and a one-time code to the account's email;
 * "confirm" with the app code AND the email code → backup codes + session.
 * Only reachable with an "enroll" ticket, i.e. right after a correct password.
 *
 * Security G4 (GK-21): the email code is what stops a password-only attacker
 * from enrolling their own authenticator on an admin who never set one up —
 * they would also need the admin's mailbox.
 */
export async function POST(request: Request) {
  try {
    const ticket = await currentOpsTicket(request);
    if (!ticket || ticket.kind !== "enroll") return jsonError("Your sign-in expired. Enter your password again.", 401);
    const body = schema.parse(await request.json());

    const user = await getUserSessionById(ticket.userId);
    if (!user) return jsonError("Your sign-in expired. Enter your password again.", 401);

    if (body.action === "start") {
      const { secret, otpauthUri } = await beginTwoFactorEnrollment(ticket.userId, OPS_TOTP_ISSUER);
      const qrSvg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      let emailSent = true;
      try {
        const { code } = await issueEmailCode(user.email, "enroll");
        const message = verificationCodeEmail(code, "enroll");
        const result = await sendTransactionalEmail({ to: user.email, subject: message.subject, text: message.text, html: message.html, tags: [{ name: "type", value: "code_enroll" }] });
        if (!result.sent) {
          if (process.env.NODE_ENV === "production") return jsonError("We couldn't send the confirmation email right now. Try again in a minute.", 503);
          console.info(`[platform/auth] enroll code for ${user.email}: ${code} (email not sent: ${result.error ?? "mock"})`);
        }
      } catch (error) {
        if (!(error instanceof AuthError && error.code === "CODE_COOLDOWN")) throw error;
        emailSent = false; // a code went out a moment ago; it is still valid
      }
      return NextResponse.json({ ok: true, secret, otpauthUri, qrSvg, emailSentTo: user.email.replace(/^(.).*(@.*)$/, "$1…$2"), emailSent });
    }

    const wait = await codeAttemptsLeft(request, ticket.userId);
    if (wait !== null) return jsonError("Too many tries. Wait a few minutes, then sign in again.", 429, { "Retry-After": String(wait) });
    await verifyEmailCode(user.email, "enroll", body.emailCode);
    const { backupCodes } = await confirmTwoFactorEnrollment(ticket.userId, body.code);
    return opsSessionResponse(ticket.userId, { backupCodes }, { action: "ops_2fa_enrolled" });
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, 400);
    if (error instanceof z.ZodError) return jsonError("Enter the 6-digit code from your app and the code we emailed you.", 400);
    console.error("[platform/auth/2fa/enroll]", error);
    return jsonError("Something went wrong.", 500);
  }
}
