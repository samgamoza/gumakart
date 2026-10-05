import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteBuyerAccount, listBuyerAddresses, updateBuyerProfile } from "@gumakart/db";
import { clearBuyerCookie, currentBuyer, gumaIdStatus, idFail, requireBuyer } from "@/lib/guma-id";

/** Who's signed in (null when signed out) + addresses, for checkout pre-fill. */
export async function GET() {
  try {
    const status = gumaIdStatus();
    const buyer = status.available ? await currentBuyer() : null;
    if (!buyer) return NextResponse.json({ ok: true, available: status.available, buyer: null });
    const addresses = await listBuyerAddresses(buyer.id);
    return NextResponse.json({
      ok: true,
      available: true,
      buyer: { phone: buyer.phone, name: buyer.name, email: buyer.email, preferredPayment: buyer.preferredPayment },
      addresses,
    });
  } catch (error) {
    return idFail(error, "me");
  }
}

const patchSchema = z.object({
  name: z.string().max(120).nullish(),
  email: z.string().max(255).nullish(),
  preferredPayment: z.string().max(20).nullish(),
});

export async function PATCH(request: Request) {
  try {
    const buyer = await requireBuyer();
    const body = patchSchema.parse(await request.json());
    const updated = await updateBuyerProfile(buyer.id, body);
    return NextResponse.json({ ok: true, buyer: { phone: updated.phone, name: updated.name, email: updated.email, preferredPayment: updated.preferredPayment } });
  } catch (error) {
    return idFail(error, "me patch");
  }
}

/** Delete my Guma ID (shops keep their orders, unlinked). */
export async function DELETE() {
  try {
    const buyer = await requireBuyer();
    await deleteBuyerAccount(buyer.id);
    const res = NextResponse.json({ ok: true });
    clearBuyerCookie(res);
    return res;
  } catch (error) {
    return idFail(error, "delete");
  }
}
