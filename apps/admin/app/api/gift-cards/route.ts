import { NextResponse } from "next/server";
import { z } from "zod";
import { giftCardSummary, issueGiftCard, listGiftCards } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { giftFail } from "@/lib/gift-card-api";

/** Phase 17: gift cards and store credit (owner + manager). */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const q = new URL(request.url).searchParams.get("q");
    const [cards, summary] = await Promise.all([listGiftCards(session.tenantId, { q }), giftCardSummary(session.tenantId)]);
    return NextResponse.json({ ok: true, cards, summary });
  } catch (error) {
    return giftFail(error, "list");
  }
}

const issueSchema = z.object({
  amount: z.number().min(1, "Enter at least ₱1.").max(1_000_000),
  kind: z.enum(["gift_card", "store_credit"]).default("gift_card"),
  phone: z.string().trim().max(20).optional(),
  recipientName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = issueSchema.parse(await request.json());
    const card = await issueGiftCard({
      tenantId: session.tenantId,
      amount: body.amount,
      kind: body.kind,
      customerPhone: body.phone,
      recipientName: body.recipientName,
      note: body.note,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdByName: session.displayName?.trim() || "Seller",
    });
    await recordActivity(session, {
      action: "gift_card.issued",
      entityType: "gift_card",
      entityId: card.id,
      summary: `Issued ${card.kind === "store_credit" ? "store credit" : "gift card"} ${card.code} for ₱${card.initialAmount.toFixed(2)}${card.recipientName ? ` to ${card.recipientName}` : ""}`,
    });
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    return giftFail(error, "issue");
  }
}
