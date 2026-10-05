import { NextResponse } from "next/server";
import { z } from "zod";
import { listBuyerShops, setBuyerShopReminders } from "@gumakart/db";
import { idFail, requireBuyer } from "@/lib/guma-id";

/** Turn a shop's reminder/marketing texts on or off (order updates always come). */
export async function POST(request: Request) {
  try {
    const buyer = await requireBuyer();
    const body = z.object({ tenantId: z.string().uuid(), on: z.boolean() }).parse(await request.json());
    const shops = await listBuyerShops(buyer);
    if (!shops.some((s) => s.tenantId === body.tenantId)) return NextResponse.json({ ok: false, error: "Hindi ka pa nag-order sa shop na ito." }, { status: 404 });
    await setBuyerShopReminders(buyer, body.tenantId, body.on);
    return NextResponse.json({ ok: true, shops: await listBuyerShops(buyer) });
  } catch (error) {
    return idFail(error, "reminders");
  }
}
