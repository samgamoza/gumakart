import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { emailVerificationCodes, getDb } from "@gumakart/db";
import { AuthError } from "./types";

/**
 * Six-digit email codes for signup and for verifying older accounts.
 *
 *  - stored as HMAC(AUTH_SECRET, email|purpose|code), never in clear text
 *  - valid for 10 minutes, one live code per email+purpose (a new one replaces the old)
 *  - 5 wrong guesses lock that code; a new one can be requested after 60 s
 *  - a correct code is consumed, so it can't be replayed
 *
 * After a correct signup code the caller gets a short-lived signed "signup ticket"
 * (proof the email is verified) that /api/auth/signup requires.
 */

export type EmailCodePurpose = "signup" | "verify" | "reset";

export const EMAIL_CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_CODE_RESEND_SECONDS = 60;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const SIGNUP_TICKET_TTL_SECONDS = 30 * 60;

function secretString(): string {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-only-gumakart-auth-secret-min-32-chars" : undefined);
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short.");
  }
  return secret;
}

export function normalizeCodeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return createHmac("sha256", secretString()).update(`${email}|${purpose}|${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Creates a new code (replacing any live one). Throws CODE_COOLDOWN if asked again too soon. */
export async function issueEmailCode(
  rawEmail: string,
  purpose: EmailCodePurpose
): Promise<{ code: string; expiresInSeconds: number }> {
  const email = normalizeCodeEmail(rawEmail);
  const db = getDb();
  const now = new Date();

  const [latest] = await db
    .select({ createdAt: emailVerificationCodes.createdAt })
    .from(emailVerificationCodes)
    .where(and(eq(emailVerificationCodes.email, email), eq(emailVerificationCodes.purpose, purpose)))
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1);
  if (latest) {
    const waited = (now.getTime() - latest.createdAt.getTime()) / 1000;
    if (waited < EMAIL_CODE_RESEND_SECONDS) {
      throw new AuthError(
        `Please wait ${Math.ceil(EMAIL_CODE_RESEND_SECONDS - waited)} seconds before requesting another code.`,
        "CODE_COOLDOWN"
      );
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await db.transaction(async (tx) => {
    // Retire any code still live for this email + purpose.
    await tx
      .update(emailVerificationCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          eq(emailVerificationCodes.purpose, purpose),
          isNull(emailVerificationCodes.consumedAt)
        )
      );
    await tx.insert(emailVerificationCodes).values({
      email,
      purpose,
      codeHash: hashCode(email, purpose, code),
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_SECONDS * 1000),
    });
  });

  return { code, expiresInSeconds: EMAIL_CODE_TTL_SECONDS };
}

/** Checks a code. Consumes it on success; counts the attempt on failure. */
export async function verifyEmailCode(
  rawEmail: string,
  purpose: EmailCodePurpose,
  rawCode: string
): Promise<void> {
  const email = normalizeCodeEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  const db = getDb();
  const now = new Date();

  const [row] = await db
    .select()
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        eq(emailVerificationCodes.purpose, purpose),
        isNull(emailVerificationCodes.consumedAt),
        gt(emailVerificationCodes.expiresAt, now)
      )
    )
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1);

  if (!row) {
    throw new AuthError("This code has expired. Request a new one.", "CODE_EXPIRED");
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    throw new AuthError("Too many wrong tries. Request a new code.", "CODE_LOCKED");
  }

  if (code.length !== 6 || !sameHash(row.codeHash, hashCode(email, purpose, code))) {
    const attempts = row.attempts + 1;
    await db
      .update(emailVerificationCodes)
      .set({ attempts })
      .where(eq(emailVerificationCodes.id, row.id));
    const left = EMAIL_CODE_MAX_ATTEMPTS - attempts;
    throw new AuthError(
      left > 0
        ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "Too many wrong tries. Request a new code.",
      left > 0 ? "CODE_INVALID" : "CODE_LOCKED"
    );
  }

  // Consume atomically so two parallel submits can't both succeed.
  const consumed = await db
    .update(emailVerificationCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailVerificationCodes.id, row.id), isNull(emailVerificationCodes.consumedAt)))
    .returning({ id: emailVerificationCodes.id });
  if (consumed.length === 0) {
    throw new AuthError("This code was already used. Request a new one.", "CODE_EXPIRED");
  }
}

function ticketKey(): Uint8Array {
  return new TextEncoder().encode(secretString());
}

/** Proof (30 min) that this email passed the signup code. */
export async function createSignupTicket(rawEmail: string): Promise<string> {
  return new SignJWT({ purpose: "signup_ticket", email: normalizeCodeEmail(rawEmail) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SIGNUP_TICKET_TTL_SECONDS}s`)
    .sign(ticketKey());
}

export async function readSignupTicket(ticket: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(ticket, ticketKey());
    if (payload.purpose !== "signup_ticket" || typeof payload.email !== "string") return null;
    return payload.email;
  } catch {
    return null;
  }
}

export function verificationCodeEmail(code: string, purpose: EmailCodePurpose): {
  subject: string;
  text: string;
  html: string;
} {
  const minutes = Math.round(EMAIL_CODE_TTL_SECONDS / 60);
  const intro =
    purpose === "signup"
      ? "Use this code to finish creating your Guma Kart shop:"
      : purpose === "reset"
        ? "Use this code to reset your Guma Kart password:"
        : "Use this code to verify your Guma Kart email:";
  const subject = `${code} is your Guma Kart code`;
  const text = `${intro}\n\n${code}\n\nIt expires in ${minutes} minutes. ${purpose === "reset" ? "If you didn't ask for this, ignore this email — your password stays the same." : "If you didn't ask for this, you can ignore this email."}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:15px">${intro}</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#1d4ed8">${code}</p>
  <p style="font-size:13px;color:#475569">It expires in ${minutes} minutes. ${purpose === "reset" ? "If you didn't ask for this, ignore this email — your password stays the same." : "If you didn't ask for this, you can ignore this email."}</p>
  <p style="font-size:12px;color:#94a3b8;margin-top:32px">Guma Kart · Your business. One smart cart.</p>
</div>`;
  return { subject, text, html };
}
