import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketplaceAccount, importMarketplaceOrder, listMarketplaceListings } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { channelFail } from "@/lib/channels";

/** Demo shops only: pretend a paid order came in (or cancel the last one) to see one-stock-pool behaviour. */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const { cancel, externalOrderId } = z.object({ cancel: z.boolean().default(false), externalOrderId: z.string().max(80).optional() }).parse(await request.json().catch(() => ({})));
    const account = await getMarketplaceAccount(session.tenantId, accountId);
    if (!account || account.status !== "mock") return NextResponse.json({ ok: false, error: "Only for demo shops." }, { status: 403 });
    if (cancel && externalOrderId) {
      const r = await importMarketplaceOrder(session.tenantId, account, { externalOrderId, status: "cancelled", buyerName: null, createdAt: new Date(), total: 0, items: [] });
      return NextResponse.json({ ok: true, result: r });
    }
    const linked = (await listMarketplaceListings(session.tenantId, accountId)).filter((l) => l.variantId);
    if (linked.length === 0) return NextResponse.json({ ok: false, error: "Link at least one listing first." }, { status: 400 });
    const pick = linked[Math.floor(Math.random() * linked.length)]!;
    const qty = 1;
    const price = pick.price ?? 100;
    const id = `${account.platform === "shopee" ? "2610" : "LZ"}${Date.now().toString().slice(-9)}`;
    const r = await importMarketplaceOrder(session.tenantId, account, {
      externalOrderId: id,
      status: "to_ship",
      buyerName: account.platform === "shopee" ? "shopee_buyer_ph" : "Lazada Buyer",
      createdAt: new Date(),
      total: price * qty,
      items: [{ externalItemId: pick.externalItemId, externalModelId: pick.externalModelId, sku: pick.sku, title: pick.title, quantity: qty, unitPrice: price }],
    });
    return NextResponse.json({ ok: true, externalOrderId: id, result: r });
  } catch (error) {
    return channelFail(error, "marketplace simulate");
  }
}
