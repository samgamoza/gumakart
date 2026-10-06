import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeliveryBooking, recordDeliveryQuote } from "@gumakart/db";
import { createLogger, dispatch, IntegrationNotConfiguredError } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { BookingError, prepareBooking } from "@/lib/delivery-booking";

const log = createLogger("orders:book-delivery");

const bodySchema = z
  .object({ provider: z.enum(["lalamove", "grab", "bayango", "manual"]).optional() })
  .optional();

/**
 * Books a courier. With no body: the best available (preferred app → failover → own rider).
 * Phase 33 (H7): with `{ provider }` from the comparison, books only that courier (no silent switch).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);
    const raw = await request.text();
    const body = bodySchema.parse(raw.trim() ? JSON.parse(raw) : undefined);

    const prepared = await prepareBooking(session.tenantId, session.tenantName, orderId);
    const { order } = prepared;
    let policy = prepared.policy;
    if (body?.provider) {
      if (!policy.allow?.includes(body.provider)) {
        return NextResponse.json({ ok: false, error: "That courier isn't available for this shop." }, { status: 400 });
      }
      policy = { ...policy, allow: [body.provider], preferInHouse: false };
    }

    const result = await dispatch(prepared.input, policy);

    const provider = result.booking.provider;
    if (
      provider !== "lalamove" &&
      provider !== "grab" &&
      provider !== "manual" &&
      provider !== "bayango"
    ) {
      return NextResponse.json(
        { ok: false, error: "Unsupported delivery provider." },
        { status: 502 }
      );
    }

    const quoteRowId = await recordDeliveryQuote({
      tenantId: session.tenantId,
      orderId: order.orderId,
      provider,
      quoteId: result.quote.quoteRef,
      fee: result.quote.fee.toFixed(2),
      etaMinutes: result.quote.etaMinutes,
      expiresAt: result.quote.expiresAt ? new Date(result.quote.expiresAt) : undefined,
      rawResponseJson: {
        meta: result.quote.meta,
        failedOver: result.failedOver,
      },
    });

    await createDeliveryBooking({
      orderId: order.orderId,
      quoteId: quoteRowId,
      provider,
      providerOrderId: result.booking.providerOrderId,
      status: result.booking.status,
      trackingUrl: result.booking.trackingUrl,
    });

    return NextResponse.json({
      ok: true,
      delivery: {
        provider,
        providerOrderId: result.booking.providerOrderId,
        status: result.booking.status,
        trackingUrl: result.booking.trackingUrl ?? null,
        fee: result.quote.fee,
        failedOver: result.failedOver,
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof BookingError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }
    if (error instanceof IntegrationNotConfiguredError) {
      log.error("Rider booking blocked — integration not configured", error);
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          integration: error.integration,
          code: "integration_not_configured",
        },
        { status: 503 }
      );
    }
    log.error("Rider booking failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not book a rider right now. Try again shortly.",
      },
      { status: 502 }
    );
  }
}
