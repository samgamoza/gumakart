import { NextResponse } from "next/server";
import { z } from "zod";
import { createPosSale, ensureRegister, getOpenShift, PosError } from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

const bodySchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  items: z
    .array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().nullish(), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(100),
  discountType: z.enum(["none", "senior", "pwd"]).default("none"),
  discountHolder: z.object({ name: z.string().max(120).optional(), idNumber: z.string().max(40).optional() }).optional(),
  tenders: z
    .array(
      z.object({
        method: z.enum(["cash", "gcash", "maya", "card"]),
        amount: z.number().positive().max(10_000_000),
        reference: z.string().max(60).optional(),
      })
    )
    .min(1)
    .max(2),
  customer: z.object({ name: z.string().max(120).optional(), phone: z.string().max(20).optional() }).optional(),
});

/** Ring up a sale on the open shift. Retrying with the same key returns the same sale. */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    const limited = await rateLimit(`pos-sale:${actor.tenantId}:${clientIpFrom(request)}`, { limit: 120, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Slow down a little and try again." }, { status: 429 });
    const body = bodySchema.parse(await request.json());
    if (body.discountType !== "none" && !body.discountHolder?.idNumber?.trim()) {
      throw new PosError("Enter the Senior/PWD ID number for the discount.", "EMPTY");
    }
    const register = await ensureRegister(actor.tenantId);
    const shift = await getOpenShift(actor.tenantId, register.id);
    if (!shift) throw new PosError("Open a shift first.", "NO_SHIFT");
    const receipt = await createPosSale({
      tenantId: actor.tenantId,
      shiftId: shift.id,
      staffId: actor.staffId,
      userId: actor.userId,
      cashierName: actor.name,
      idempotencyKey: body.idempotencyKey,
      items: body.items,
      discountType: body.discountType,
      discountHolder: body.discountHolder ?? null,
      tenders: body.tenders,
      customer: body.customer ?? null,
    });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return posErrorResponse(error, "sale");
  }
}
