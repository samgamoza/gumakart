import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkoutHttpRejectionForStatus,
  getTenantAvailabilityBySlug,
  getTenantStorefrontBySlug,
} from "@gumakart/db";
import {
  clientIpFrom,
  generateOrderNumber,
  logIntegrationStatusOnce,
  rateLimit,
} from "@gumakart/services";
import { getTenant as getDemoTenant } from "@/lib/demo-data";
import { checkoutSchema, placeOrder, type CheckoutBody } from "@/lib/place-order";
import { sanitizeUtm } from "@/lib/utm";

export async function POST(request: Request) {
  logIntegrationStatusOnce();

  const limited = await rateLimit(`checkout:${clientIpFrom(request)}`, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  let body: CheckoutBody;
  try {
    body = checkoutSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.errors[0]?.message ?? "Invalid checkout data."
        : "Invalid checkout data.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (body.fulfillment === "delivery" && (body.address?.length ?? 0) < 10) {
    return NextResponse.json(
      { error: "Please enter your complete delivery address." },
      { status: 400 }
    );
  }

  try {
    // Demo only when no real shop owns the slug — a demo must never swallow a real order.
    const realShop = await getTenantAvailabilityBySlug(body.tenantSlug);
    const demo = realShop ? null : getDemoTenant(body.tenantSlug);
    if (demo) {
      const orderNumber = generateOrderNumber("DMO");
      return NextResponse.json({
        orderNumber,
        status: body.paymentMethod === "cod" ? "accepted" : "pending_payment",
        paymentMethod: body.paymentMethod,
        demo: true,
      });
    }

    const tenant = await getTenantStorefrontBySlug(body.tenantSlug);
    if (!tenant) {
      const availability = await getTenantAvailabilityBySlug(body.tenantSlug);
      const suspended = checkoutHttpRejectionForStatus(availability?.status);
      if (suspended) {
        return NextResponse.json(
          { error: suspended.error, code: suspended.code },
          { status: suspended.httpStatus }
        );
      }
      return NextResponse.json({ error: "Shop not found." }, { status: 404 });
    }

    // Phase 13: the ref/utm the buyer arrived with (kept in the tab by AttributionCapture).
    return placeOrder(tenant, body, { sourceChannel: "storefront", utm: sanitizeUtm(body.utm) });
  } catch (error) {
    console.error("[checkout] failed before placing the order:", error);
    return NextResponse.json({ error: "Checkout failed. Please try again." }, { status: 500 });
  }
}
