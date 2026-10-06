import { NextResponse } from "next/server";
import { z } from "zod";
import { getCheckoutLinkForTenant, getProductForTenant } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { runAssistForTenant } from "@/lib/ai-assist";
import type { CaptionsOutput } from "@gumakart/ai";

const schema = z.union([
  z.object({ productId: z.string().uuid(), notes: z.string().max(600).optional() }),
  z.object({ linkId: z.string().uuid(), notes: z.string().max(600).optional() }),
]);

const storefront = () => (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010").replace(/\/$/, "");

/** Phase 26: Facebook / Instagram / TikTok captions for a product or checkout link, link included. */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    let productTitle: string;
    let price: number | null = null;
    let details = body.notes ?? "";
    let link: string;
    if ("productId" in body) {
      const product = await getProductForTenant(session.tenantId, body.productId);
      if (!product) return NextResponse.json({ ok: false, error: "Product not found." }, { status: 404 });
      productTitle = product.title;
      price = Number(product.basePrice) || null;
      details ||= (product.descriptionHtml ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      link = `${storefront()}/${session.tenantSlug}/products/${product.slug}`;
    } else {
      const l = await getCheckoutLinkForTenant(session.tenantId, body.linkId);
      if (!l) return NextResponse.json({ ok: false, error: "Checkout link not found." }, { status: 404 });
      productTitle = l.title;
      price = l.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0) || null;
      link = `${storefront()}/c/${l.code}`;
    }
    const result = await runAssistForTenant<CaptionsOutput>(session.tenantId, "captions", {
      shopName: session.tenantName,
      productTitle,
      price,
      details,
      link,
    });
    if (!result.ok) return result.response;
    return NextResponse.json({ ok: true, captions: result.output, link });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Pick a product or checkout link." }, { status: 400 });
    console.error("[ai/captions]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
