import { NextResponse } from "next/server";
import { z } from "zod";
import { disconnectMarketplaceAccount, getMarketplaceAccount, listMarketplaceListings, updateMarketplaceAccount } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { channelFail } from "@/lib/channels";

/** A marketplace shop's listings and their links to Guma products. */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const account = await getMarketplaceAccount(session.tenantId, accountId);
    if (!account) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, listings: await listMarketplaceListings(session.tenantId, accountId) });
  } catch (error) {
    return channelFail(error, "marketplace listings");
  }
}

/** Turn stock sync / order import on or off. */
export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const patch = z.object({ syncStock: z.boolean().optional(), importOrders: z.boolean().optional() }).strict().parse(await request.json());
    const ok = await updateMarketplaceAccount(session.tenantId, accountId, patch);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "marketplace settings");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { accountId } = await params;
    z.string().uuid().parse(accountId);
    const ok = await disconnectMarketplaceAccount(session.tenantId, accountId);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    await recordActivity(session, { action: "channels.marketplace_disconnected", entityType: "channel", entityId: accountId, summary: "Disconnected a marketplace shop" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return channelFail(error, "marketplace disconnect");
  }
}
