import { NextResponse } from "next/server";
import { z } from "zod";
import { buyerOtpSecret } from "@gumakart/auth/buyer-token";
import { createBuyerOtp, OTP_TTL_MINUTES } from "@gumakart/db";
import { clientIpFrom, createSemaphoreClient, rateLimit } from "@gumakart/services";
import { gumaIdStatus, idFail, unavailable } from "@/lib/guma-id";

/** Text a 6-digit Guma ID code. */
export async function POST(request: Request) {
  try {
    const status = gumaIdStatus();
    if (!status.available) return unavailable();
    const limited = await rateLimit(`guma-id-otp:${clientIpFrom(request)}`, { limit: 8, windowSeconds: 600 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Masyadong maraming subok. Maghintay ng ilang minuto." }, { status: 429 });
    const { phone } = z.object({ phone: z.string().max(20) }).parse(await request.json());
    const otp = await createBuyerOtp(phone, buyerOtpSecret(), clientIpFrom(request));
    // ASCII only (SMS segments); no shop name — this is Guma's own message.
    const sent = await createSemaphoreClient().send({
      to: otp.phone,
      message: `Guma ID code: ${otp.code}. Valid for ${OTP_TTL_MINUTES} min. Huwag ibigay kahit kanino.`,
      priority: true,
    });
    if (!sent.success) return NextResponse.json({ ok: false, error: "Hindi namin ma-text ang code ngayon. Subukan ulit mamaya." }, { status: 502 });
    return NextResponse.json({
      ok: true,
      phone: otp.phone,
      expiresAt: otp.expiresAt,
      // Local development only (labeled SMS mock, never in production): show the code.
      ...(sent.mock && status.smsMock ? { devCode: otp.code } : {}),
    });
  } catch (error) {
    return idFail(error, "otp");
  }
}
