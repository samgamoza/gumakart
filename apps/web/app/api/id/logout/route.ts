import { NextResponse } from "next/server";
import { bumpBuyerSession } from "@gumakart/db";
import { clearBuyerCookie, currentBuyer, idFail } from "@/lib/guma-id";

/** Sign out (?everywhere=1 signs out every device). */
export async function POST(request: Request) {
  try {
    const everywhere = new URL(request.url).searchParams.get("everywhere") === "1";
    const buyer = await currentBuyer();
    if (buyer && everywhere) await bumpBuyerSession(buyer.id);
    const res = NextResponse.json({ ok: true });
    clearBuyerCookie(res);
    return res;
  } catch (error) {
    return idFail(error, "logout");
  }
}
