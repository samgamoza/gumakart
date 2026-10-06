import { NextResponse } from "next/server";
import { z } from "zod";
import { GiftCardError, checkGiftCardForSlug } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";

const schema = z.object({ tenantSlug: z.string().min(1).max(64), code: z.string().trim().min(6).max(24) });

/** Phase 17: checkout preview — is this gift card / store credit code good, and how much is on it? */
export async function POST(request: Request) {
  const limited = await rateLimit(`giftcard:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 60 });
  if (!limited.allowed) return NextResponse.json({ ok: false, error: "Masyadong maraming subok. Maghintay ng isang minuto." }, { status: 429 });
  try {
    const body = schema.parse(await request.json());
    const card = await checkGiftCardForSlug(body.tenantSlug, body.code);
    return NextResponse.json({ ok: true, code: card.code, balance: card.balance, kind: card.kind });
  } catch (error) {
    if (error instanceof GiftCardError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Ilagay ang buong code (GC-XXXX-XXXX)." }, { status: 400 });
    console.error("[gift-card check]", error);
    return NextResponse.json({ ok: false, error: "Hindi ma-check ang card ngayon." }, { status: 500 });
  }
}
