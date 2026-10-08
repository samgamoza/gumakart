import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserEmail } from "@gumakart/auth";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const bodySchema = z.object({
  token: z.string().min(10),
});

/**
 * Legacy emailed-link verification. Security G1 (GK-8): the link now only marks the
 * address verified — it is single use and never signs anyone in. The person signs in
 * normally afterwards. New codes are sent by /api/auth/verify-email/code.
 */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`verify-link:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 600 });
    if (!limited.allowed) {
      return NextResponse.json({ ok: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
    }
    const { token } = bodySchema.parse(await request.json());
    const user = await verifyUserEmail(token);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "This verification link is invalid, expired or already used." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, verified: true, redirectTo: "/login?verified=1" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "This verification link is invalid." }, { status: 400 });
    }
    console.error("[auth/verify-email]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
