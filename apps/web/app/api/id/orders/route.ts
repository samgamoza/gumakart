import { NextResponse } from "next/server";
import { listBuyerOrders, listBuyerShops } from "@gumakart/db";
import { idFail, requireBuyer } from "@/lib/guma-id";

/** All my orders from every Guma Kart shop, plus reminder settings per shop. */
export async function GET() {
  try {
    const buyer = await requireBuyer();
    const [orders, shops] = await Promise.all([listBuyerOrders(buyer), listBuyerShops(buyer)]);
    return NextResponse.json({ ok: true, orders, shops });
  } catch (error) {
    return idFail(error, "orders");
  }
}
