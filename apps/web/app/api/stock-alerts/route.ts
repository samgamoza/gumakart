import { NextResponse } from "next/server";
import { z } from "zod";
import { createStockAlert, DemandError, getTenantIdBySlug } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { currentBuyer } from "@/lib/guma-id";

const schema = z.object({
  tenantSlug: z.string().min(1).max(64),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(255).optional(),
});

/** Phase 22: "Notify me when it's back" on a sold-out item. */
export async function POST(request: Request) {
  try {
    const limited = await rateLimit(`stock-alert:${clientIpFrom(request)}`, { limit: 10, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Too many tries. Wait a minute." }, { status: 429 });
    const body = schema.parse(await request.json());
    const tenantId = await getTenantIdBySlug(body.tenantSlug);
    if (!tenantId) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    const buyer = await currentBuyer().catch(() => null);
    await createStockAlert({
      tenantId,
      productId: body.productId,
      variantId: body.variantId ?? null,
      phone: body.phone || null,
      email: body.email || null,
      buyerAccountId: buyer?.id ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Check the details." }, { status: 400 });
    if (error instanceof DemandError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[stock-alerts]", error);
    return NextResponse.json({ ok: false, error: "Could not save that." }, { status: 500 });
  }
}
