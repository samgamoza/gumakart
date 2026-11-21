import { NextResponse } from "next/server";
import { createReorderLink, normalizeSalesChannel, CHECKOUT_LINK_SHARE_CHANNELS, type CheckoutLinkShareChannel } from "@gumakart/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AI suite Phase 4: "Order again" links in payday / restock broadcasts.
 * kart.guma.one/{shop}/reorder/{orderId} → a checkout link with the same items (still-for-sale
 * products only; stock checked again at checkout) → /c/{code}. Falls back to the shop page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string; orderId: string }> }) {
  const { tenantSlug, orderId } = await params;
  const url = new URL(request.url);
  const shopUrl = new URL(`/${encodeURIComponent(tenantSlug)}`, url);
  if (!UUID.test(orderId) || !/^[a-z0-9-]{1,64}$/.test(tenantSlug)) return NextResponse.redirect(shopUrl, 302);
  const ref = normalizeSalesChannel(url.searchParams.get("ref"));
  const channel = ref && (CHECKOUT_LINK_SHARE_CHANNELS as readonly string[]).includes(ref) ? (ref as CheckoutLinkShareChannel) : null;
  try {
    const link = await createReorderLink(tenantSlug, orderId, { channel });
    if (!link) return NextResponse.redirect(shopUrl, 302);
    const dest = new URL(`/c/${encodeURIComponent(link.code)}`, url);
    for (const k of ["ref", "utm_source", "utm_medium", "utm_campaign"]) {
      const v = url.searchParams.get(k);
      if (v) dest.searchParams.set(k, v.slice(0, 60));
    }
    return NextResponse.redirect(dest, 302);
  } catch (error) {
    console.error("[reorder]", error);
    return NextResponse.redirect(shopUrl, 302);
  }
}
