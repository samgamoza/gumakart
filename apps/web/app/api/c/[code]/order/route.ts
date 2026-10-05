import { NextResponse } from "next/server";
import { z } from "zod";
import { getCheckoutLinkByCode, getTenantStorefrontBySlug } from "@gumakart/db";
import { clientIpFrom, logIntegrationStatusOnce, rateLimit } from "@gumakart/services";
import { closedLinkMessage } from "@/lib/checkout-link-guard";
import { checkoutSchema, placeOrder } from "@/lib/place-order";
import { sanitizeUtm } from "@/lib/utm";

/**
 * Place an order from a checkout link. The link decides WHAT is bought (products,
 * and quantities unless the seller allowed changes) and which payment / delivery
 * options exist; the buyer only sends their details and choices.
 */
const linkOrderSchema = checkoutSchema
  .omit({ tenantSlug: true, items: true, couponCode: true })
  .extend({
    /** line key (variantId, else productId) → quantity; only used when the link allows quantity changes. */
    quantities: z.record(z.string().uuid(), z.number().int().min(1).max(99)).optional(),
    utm: z.record(z.string()).optional(),
  });

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  logIntegrationStatusOnce();
  const limited = await rateLimit(`checkout-link:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 60 });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Masyadong maraming subok. Maghintay ng isang minuto at subukan ulit." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const { code } = await params;
  let input: z.infer<typeof linkOrderSchema>;
  try {
    input = linkOrderSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Pakicheck ang mga detalye mo." : "Pakicheck ang mga detalye mo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const link = await getCheckoutLinkByCode(code);
    if (!link) return NextResponse.json({ error: "Walang ganitong link." }, { status: 404 });
    const closed = closedLinkMessage(link);
    if (closed) return NextResponse.json({ error: closed, code: "LINK_CLOSED" }, { status: 410 });

    if (link.paymentMethods && !link.paymentMethods.includes(input.paymentMethod as never)) {
      return NextResponse.json({ error: "Hindi tinatanggap ang payment method na ito sa link." }, { status: 400 });
    }
    if (link.deliveryMode !== "both" && input.fulfillment !== link.deliveryMode) {
      return NextResponse.json(
        { error: link.deliveryMode === "pickup" ? "Pang-pickup lang ang link na ito." : "Pang-delivery lang ang link na ito." },
        { status: 400 }
      );
    }
    if (input.fulfillment === "delivery" && (input.address?.length ?? 0) < 10) {
      return NextResponse.json({ error: "Pakilagay ang buong delivery address mo." }, { status: 400 });
    }

    const tenant = await getTenantStorefrontBySlug(link.tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: "Hindi tumatanggap ng order ang shop na ito ngayon." }, { status: 410 });
    }

    const items = link.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      qty: link.allowQuantityEdit
        ? (input.quantities?.[item.variantId ?? item.productId] ?? input.quantities?.[item.productId] ?? item.quantity)
        : item.quantity,
    }));

    const { quantities: _q, utm, ...rest } = input;
    const body = checkoutSchema.parse({
      ...rest,
      tenantSlug: link.tenantSlug,
      items,
      couponCode: link.couponCode ?? undefined,
    });

    return placeOrder(tenant, body, {
      sourceChannel: "checkout_link",
      checkoutLinkId: link.id,
      utm: sanitizeUtm(utm),
      sessionCart: { linkCode: link.code, items },
    });
  } catch (error) {
    console.error("[checkout-link order]", error);
    return NextResponse.json({ error: "Hindi natuloy ang checkout. Pakisubukan ulit." }, { status: 500 });
  }
}
