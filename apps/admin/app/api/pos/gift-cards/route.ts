import { NextResponse } from "next/server";
import { GiftCardError, checkGiftCard } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

/** Phase 17: balance check for a gift card / store credit at the register (doesn't spend). */
export async function GET(request: Request) {
  try {
    const actor = await requirePosActor();
    const code = new URL(request.url).searchParams.get("code") ?? "";
    const card = await checkGiftCard(actor.tenantId, code);
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    if (error instanceof GiftCardError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return posErrorResponse(error, "gift card");
  }
}
