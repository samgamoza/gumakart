import { NextResponse } from "next/server";
import { z } from "zod";
import { DiscountError, getDiscountSettings, saveDiscountSettings } from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";

const window = { startsAt: z.string().datetime({ offset: true }).optional().nullable(), endsAt: z.string().datetime({ offset: true }).optional().nullable() };

const schema = z.object({
  coupons: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/, "Codes can use letters, numbers, - and _."),
        type: z.enum(["percent", "fixed"]),
        value: z.number().positive().max(100000),
        minSubtotal: z.number().min(0).max(10_000_000).optional().nullable(),
        maxRedemptions: z.number().int().positive().max(1_000_000).optional().nullable(),
        oncePerBuyer: z.boolean().optional(),
        active: z.boolean().optional(),
        note: z.string().max(120).optional().nullable(),
        ...window,
      })
    )
    .max(50),
  automaticDiscount: z
    .object({ type: z.enum(["percent", "fixed"]), value: z.number().positive().max(100000), minSubtotal: z.number().min(0).optional().nullable(), label: z.string().max(80).optional().nullable(), ...window })
    .nullable(),
  volumeDiscounts: z
    .array(
      z.object({
        id: z.string().max(40).optional(),
        label: z.string().trim().min(2).max(60),
        productIds: z.array(z.string().uuid()).max(200),
        minQty: z.number().int().min(2).max(1000),
        type: z.enum(["percent", "fixed"]),
        value: z.number().positive().max(100000),
        active: z.boolean().optional(),
        ...window,
      })
    )
    .max(20),
});

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

/** Phase 14: coupons, the automatic discount and quantity deals (live right away). */
export async function GET() {
  try {
    const session = await requireTenantSession();
    const data = await getDiscountSettings(session.tenantId);
    if (!data) return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    console.error("[discounts GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = schema.parse(await request.json());
    for (const d of body.volumeDiscounts) {
      if (d.type === "percent" && d.value > 100) throw new DiscountError("A percent deal can't be more than 100%.");
    }
    for (const c of body.coupons) {
      if (c.type === "percent" && c.value > 100) throw new DiscountError(`Coupon ${c.code}: a percent can't be more than 100%.`);
    }
    const saved = await saveDiscountSettings(session.tenantId, {
      coupons: body.coupons.map((c) => clean({ ...c, code: c.code.toUpperCase() })) as never,
      automaticDiscount: body.automaticDiscount ? (clean(body.automaticDiscount) as never) : null,
      volumeDiscounts: body.volumeDiscounts.map((d, i) => clean({ ...d, id: d.id || `deal-${Date.now().toString(36)}-${i}` })) as never,
    });
    await recordActivity(session, {
      action: "discounts.saved",
      entityType: "discounts",
      summary: `Discounts saved: ${saved.coupons.length} coupon(s), ${saved.volumeDiscounts.length} deal(s)${saved.automaticDiscount ? ", automatic discount on" : ""}`,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof DiscountError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: error.errors[0]?.message ?? "Check the details." }, { status: 400 });
    console.error("[discounts PUT]", error);
    return NextResponse.json({ ok: false, error: "Could not save." }, { status: 500 });
  }
}
