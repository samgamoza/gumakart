import { NextResponse } from "next/server";
import { z } from "zod";
import {
  bumpCheckoutLinkCounter,
  checkoutSessionExists,
  getCheckoutLinkByCode,
  upsertCheckoutSession,
} from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { sanitizeUtm } from "@/lib/utm";

const bodySchema = z.object({
  sessionKey: z.string().min(8).max(64),
  customer: z.object({ name: z.string().max(120).optional(), phone: z.string().max(20).optional() }).optional(),
  address: z.record(z.string().max(300)).optional(),
  quantities: z.record(z.string().uuid(), z.number().int().min(1).max(99)).optional(),
  smsConsent: z.boolean().optional(),
  utm: z.record(z.string()).optional(),
});

/**
 * Saves checkout-link progress (for "started checkout" stats and, with consent,
 * abandoned-checkout reminders in Phase 4). The first save counts as a start.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(`checkout-link-session:${clientIpFrom(request)}`, { limit: 60, windowSeconds: 60 });
  if (!limited.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const { code } = await params;
    const body = bodySchema.parse(await request.json());
    const link = await getCheckoutLinkByCode(code);
    if (!link || link.status !== "live") return NextResponse.json({ ok: false }, { status: 404 });

    const existing = await checkoutSessionExists(link.tenantId, body.sessionKey);

    const phone = body.customer?.phone?.replace(/[\s-]/g, "") || null;
    await upsertCheckoutSession({
      tenantId: link.tenantId,
      sessionKey: body.sessionKey,
      cartJson: { linkCode: link.code, quantities: body.quantities ?? null },
      customerJson: body.customer,
      addressJson: body.address,
      phone,
      marketingConsent: body.smsConsent,
      sourceChannel: "checkout_link",
      utmJson: sanitizeUtm(body.utm) ?? undefined,
    });
    if (!existing) await bumpCheckoutLinkCounter(link.id, "start");

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false }, { status: 400 });
    console.error("[checkout-link session]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
