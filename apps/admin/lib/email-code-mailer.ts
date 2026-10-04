import { verificationCodeEmail, type EmailCodePurpose } from "@gumakart/auth";
import { sendTransactionalEmail } from "@gumakart/services";

/**
 * Emails a one-time code. In production a failed send is an error (we never
 * pretend a code went out). In local dev without RESEND_API_KEY the code is
 * returned so the page can show it.
 */
export async function deliverEmailCode(
  email: string,
  code: string,
  purpose: EmailCodePurpose
): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const message = verificationCodeEmail(code, purpose);
  const result = await sendTransactionalEmail({
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    tags: [{ name: "type", value: `code_${purpose}` }],
  });
  if (result.sent) return { ok: true };

  if (process.env.NODE_ENV !== "production") {
    console.info(`[auth] ${purpose} code for ${email}: ${code} (email not sent: ${result.error ?? "mock"})`);
    return { ok: true, devCode: code };
  }
  console.error("[auth] could not send verification code", { email, error: result.error });
  return { ok: false, error: "We couldn't send the email right now. Please try again in a minute." };
}
