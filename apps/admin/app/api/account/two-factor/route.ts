import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import {
  AuthError,
  beginTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  getSessionFromRequest,
  getTwoFactorStatus,
  isSessionCurrent,
  regenerateBackupCodes,
} from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const ISSUER = "Guma Kart";

/** The signed-in person's own account — never a support-access (ops) session acting as them. */
async function ownSession(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || session.supportAccess) return null;
  if (!(await isSessionCurrent(session.userId, session.sessionVersion))) return null;
  return session;
}

/** Phase 21: two-step sign-in status for Settings → Account. */
export async function GET(request: Request) {
  const session = await ownSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const status = await getTwoFactorStatus(session.userId);
  return NextResponse.json({ ok: true, ...status });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("confirm"), code: z.string().trim().min(6).max(12) }),
  z.object({ action: z.literal("disable"), code: z.string().trim().min(6).max(20) }),
  z.object({ action: z.literal("regenerate"), code: z.string().trim().min(6).max(20) }),
]);

/** start → QR; confirm → on + backup codes; disable / regenerate need a current code. */
export async function POST(request: Request) {
  const session = await ownSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  try {
    const body = schema.parse(await request.json());
    if (body.action !== "start") {
      const limited = await rateLimit(`2fa-manage:${session.userId}:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 900 });
      if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
    }
    switch (body.action) {
      case "start": {
        const { secret, otpauthUri } = await beginTwoFactorEnrollment(session.userId, ISSUER);
        const qrSvg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
        return NextResponse.json({ ok: true, secret, qrSvg });
      }
      case "confirm":
        return NextResponse.json({ ok: true, ...(await confirmTwoFactorEnrollment(session.userId, body.code)) });
      case "regenerate":
        return NextResponse.json({ ok: true, ...(await regenerateBackupCodes(session.userId, body.code)) });
      case "disable":
        await disableTwoFactor(session.userId, body.code);
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Enter the 6-digit code from your app." }, { status: 400 });
    console.error("[account/two-factor]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
