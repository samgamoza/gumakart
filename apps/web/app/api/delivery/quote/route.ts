import { NextResponse } from "next/server";
import { z } from "zod";
import { getTenantStorefrontBySlug } from "@gumakart/db";
import { checkoutDeliveryFee } from "@gumakart/db/shipping";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { getCheckoutDeliveryQuote } from "@/lib/delivery-quote";
import { resolveDelivery, resolveStorefrontSettings } from "@/lib/storefront-settings";

const quoteSchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  address: z.string().trim().min(10).max(500),
  /** Cart subtotal in PHP: flat-rate fallback and the free-delivery minimum. */
  subtotal: z.number().min(0).max(9999999).optional(),
  /** Structured parts so the fallback fee uses the same zones as checkout. */
  city: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`delivery-quote:${clientIpFrom(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: "Too many quote requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }

    const body = quoteSchema.parse(await request.json());
    const tenant = await getTenantStorefrontBySlug(body.tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: "Shop not found." }, { status: 404 });
    }

    const settings = resolveStorefrontSettings(
      tenant.settingsJson,
      tenant.currency ?? "PHP",
      tenant.checkoutPublishedJson,
      tenant.shippingPublishedJson
    );
    const parts = { city: body.city, barangay: body.barangay, province: body.province };
    const resolved = resolveDelivery(body.subtotal ?? 0, settings, parts);
    const quote = await getCheckoutDeliveryQuote(settings, body.address);

    if (quote) {
      return NextResponse.json({
        ok: true,
        live: true,
        provider: quote.provider,
        // Phase 17b: free delivery is the seller's promise — it wins over the courier price.
        fee: checkoutDeliveryFee(resolved, quote.fee),
        free: resolved.free,
        freeAbove: resolved.freeAbove ?? null,
        etaMinutes: quote.etaMinutes ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      live: false,
      provider: settings.delivery.provider,
      fee: resolved.fee,
      free: resolved.free,
      freeAbove: resolved.freeAbove ?? null,
      etaMinutes: resolved.etaMinutes?.max ?? resolved.etaMinutes?.min ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    console.error("Delivery quote error:", error);
    return NextResponse.json({ error: "Quote failed" }, { status: 400 });
  }
}
