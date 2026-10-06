import { NextResponse } from "next/server";
import { z } from "zod";
import { adjustGiftCard, getGiftCardHistory, setGiftCardStatus } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { giftFail } from "@/lib/gift-card-api";

export async function GET(_request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { cardId } = await params;
    z.string().uuid().parse(cardId);
    return NextResponse.json({ ok: true, history: await getGiftCardHistory(session.tenantId, cardId) });
  } catch (error) {
    return giftFail(error, "history");
  }
}

const patchSchema = z.union([
  z.object({ status: z.enum(["active", "disabled"]) }),
  z.object({ adjust: z.number().min(-1_000_000).max(1_000_000), note: z.string().trim().min(1, "Say why.").max(200) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { cardId } = await params;
    z.string().uuid().parse(cardId);
    const body = patchSchema.parse(await request.json());
    const card =
      "status" in body
        ? await setGiftCardStatus(session.tenantId, cardId, body.status)
        : await adjustGiftCard(session.tenantId, cardId, body.adjust, body.note, session.displayName?.trim() || "Seller");
    await recordActivity(session, {
      action: "status" in body ? `gift_card.${body.status}` : "gift_card.adjusted",
      entityType: "gift_card",
      entityId: card.id,
      summary: "status" in body ? `${body.status === "disabled" ? "Disabled" : "Re-enabled"} ${card.code}` : `Adjusted ${card.code} by ₱${body.adjust.toFixed(2)} (${body.note}) — balance ₱${card.balance.toFixed(2)}`,
    });
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    return giftFail(error, "update");
  }
}
