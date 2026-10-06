import { NextResponse } from "next/server";
import { z } from "zod";
import { LoyaltyError, redeemLoyaltyPoints } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const schema = z.object({ points: z.number().int().positive().optional() });

/** Phase 27: convert a buyer's Suki points into a store-credit code (default: all of them). */
export async function POST(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { customerId } = await params;
    z.string().uuid().parse(customerId);
    const body = schema.parse(await request.json().catch(() => ({})));
    const result = await redeemLoyaltyPoints({
      tenantId: session.tenantId,
      customerId,
      points: body.points,
      actorName: session.displayName?.trim() || "Seller",
    });
    await recordActivity(session, {
      action: "loyalty.redeemed",
      entityType: "gift_card",
      entityId: result.card.id,
      summary: `Converted ${result.points} Suki points to ₱${result.amount.toFixed(2)} store credit (${result.card.code})`,
    });
    return NextResponse.json({ ok: true, points: result.points, amount: result.amount, code: result.card.code, balance: result.balance });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof LoyaltyError) return NextResponse.json({ ok: false, error: error.message }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Enter a whole number of points." }, { status: 400 });
    console.error("[loyalty/redeem]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
