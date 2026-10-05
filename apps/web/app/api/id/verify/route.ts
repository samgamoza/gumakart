import { NextResponse } from "next/server";
import { z } from "zod";
import { buyerOtpSecret } from "@gumakart/auth/buyer-token";
import { verifyBuyerOtp } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { gumaIdStatus, idFail, setBuyerCookie, unavailable } from "@/lib/guma-id";

/** Check the code and sign in (creates the Guma ID on first use). */
export async function POST(request: Request) {
  try {
    if (!gumaIdStatus().available) return unavailable();
    const limited = await rateLimit(`guma-id-verify:${clientIpFrom(request)}`, { limit: 20, windowSeconds: 600 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Masyadong maraming subok. Maghintay ng ilang minuto." }, { status: 429 });
    const body = z.object({ phone: z.string().max(20), code: z.string().max(10) }).parse(await request.json());
    const { buyer, isNew } = await verifyBuyerOtp(body.phone, body.code, buyerOtpSecret());
    const res = NextResponse.json({ ok: true, isNew, buyer: { phone: buyer.phone, name: buyer.name } });
    await setBuyerCookie(res, buyer);
    return res;
  } catch (error) {
    return idFail(error, "verify");
  }
}
