import { NextResponse } from "next/server";
import { z } from "zod";
import { autoSelect, compareQuotes, createLogger, quoteAll, type DeliveryQuote } from "@gumakart/services";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { BookingError, PROVIDER_LABELS, prepareBooking } from "@/lib/delivery-booking";

const log = createLogger("orders:delivery-quotes");

/**
 * Phase 33 (H7, palenkeAi "DeliveryRiderEstimator"): live quotes from every courier this shop can use,
 * side by side, so the seller picks one. Nothing is booked here; the seller books from the list.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await requireTenantSession();
    const { orderId } = await params;
    z.string().uuid().parse(orderId);

    const prepared = await prepareBooking(session.tenantId, session.tenantName, orderId);
    const attempts = await quoteAll(prepared.input.request, prepared.policy);
    const quotes = attempts.map((a) => a.quote).filter((q): q is DeliveryQuote => Boolean(q));
    const best = autoSelect(quotes, prepared.policy);
    const cheapest = quotes.length ? Math.min(...quotes.map((q) => q.fee)) : null;

    const options = [...quotes].sort(compareQuotes).map((q) => ({
      provider: q.provider,
      label: PROVIDER_LABELS[q.provider] ?? q.provider,
      fee: q.fee,
      etaMinutes: q.etaMinutes ?? null,
      distanceKm: q.distanceKm != null ? Math.round(q.distanceKm * 10) / 10 : null,
      recommended: best?.provider === q.provider,
      cheapest: cheapest != null && q.fee === cheapest,
    }));
    const unavailable = attempts
      .filter((a) => !a.quote)
      .map((a) => ({ provider: a.provider, label: PROVIDER_LABELS[a.provider] ?? a.provider, reason: a.error ?? "No quote." }));

    return NextResponse.json({ ok: true, orderNumber: prepared.order.orderNumber, options, unavailable });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof BookingError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid order id." }, { status: 400 });
    log.error("Courier quotes failed", error);
    return NextResponse.json({ ok: false, error: "Could not get courier prices right now." }, { status: 502 });
  }
}
