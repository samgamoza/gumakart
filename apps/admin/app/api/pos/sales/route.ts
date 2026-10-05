import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPosSale,
  ensureRegister,
  getOpenShift,
  getPosStaffForAuth,
  PosError,
  recordRejectedOfflineSale,
  type PosOfflineInfo,
} from "@gumakart/db";
import { clientIpFrom, rateLimit } from "@gumakart/services";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

const totalsSchema = z
  .object({
    subtotal: z.number(),
    discountAmount: z.number(),
    total: z.number().min(0).max(10_000_000),
    vatAmount: z.number(),
  })
  .passthrough();

const bodySchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        quantity: z.number().int().min(1).max(999),
        // Offline only: the price the register showed (it had no way to check).
        unitPrice: z.number().min(0).max(10_000_000).nullish(),
      })
    )
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
  /** Phase 12b: a sale rung while the register had no internet, synced now. */
  offline: z
    .object({
      rungAt: z.string().datetime({ offset: true }),
      shiftId: z.string().uuid(),
      deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
      invoiceNumber: z.string().max(32).nullish(),
      totals: totalsSchema.nullish(),
      staffId: z.string().uuid().nullish(),
      cashierName: z.string().max(80).nullish(),
    })
    .optional(),
});

/** Ring up a sale on the open shift. Retrying with the same key returns the same sale. */
export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema> | null = null;
  let tenantId: string | null = null;
  try {
    const actor = await requirePosActor();
    tenantId = actor.tenantId;
    const limited = await rateLimit(`pos-sale:${actor.tenantId}:${clientIpFrom(request)}`, { limit: 120, windowSeconds: 60 });
    if (!limited.allowed) return NextResponse.json({ ok: false, error: "Slow down a little and try again." }, { status: 429 });
    const body = bodySchema.parse(await request.json());
    parsed = body;
    if (body.discountType !== "none" && !body.discountHolder?.idNumber?.trim()) {
      throw new PosError("Enter the Senior/PWD ID number for the discount.", "EMPTY");
    }

    let shiftId: string;
    let staffId = actor.staffId;
    let cashierName = actor.name;
    let offline: PosOfflineInfo | null = null;
    if (body.offline) {
      // Rung earlier, maybe by another cashier: credit whoever was signed in on the device.
      shiftId = body.offline.shiftId;
      offline = {
        rungAt: new Date(body.offline.rungAt),
        deviceId: body.offline.deviceId,
        invoiceNumber: body.offline.invoiceNumber ?? null,
        totals: (body.offline.totals as PosOfflineInfo["totals"]) ?? null,
      };
      if (body.offline.staffId && body.offline.staffId !== actor.staffId) {
        const staff = await getPosStaffForAuth(actor.tenantId, body.offline.staffId);
        if (staff) {
          staffId = staff.id;
          cashierName = staff.name;
        }
      } else if (!body.offline.staffId && actor.staffId && body.offline.cashierName) {
        staffId = null;
        cashierName = body.offline.cashierName.trim().slice(0, 80) || actor.name;
      }
    } else {
      const register = await ensureRegister(actor.tenantId);
      const shift = await getOpenShift(actor.tenantId, register.id);
      if (!shift) throw new PosError("Open a shift first.", "NO_SHIFT");
      shiftId = shift.id;
    }

    const receipt = await createPosSale({
      tenantId: actor.tenantId,
      shiftId,
      staffId,
      userId: actor.userId,
      cashierName,
      idempotencyKey: body.idempotencyKey,
      items: body.items.map((i) => ({ ...i, unitPrice: body.offline ? i.unitPrice : undefined })),
      discountType: body.discountType,
      discountHolder: body.discountHolder ?? null,
      tenders: body.tenders,
      customer: body.customer ?? null,
      offline,
    });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    // An offline sale already happened at the counter. If the server can't record it as a
    // sale (product deleted, shift not found, payments don't add up), keep the whole thing
    // for the owner to sort out and tell the device to stop retrying.
    if (parsed?.offline && tenantId && isPermanentSaleError(error)) {
      await recordRejectedOfflineSale({
        tenantId,
        idempotencyKey: parsed.idempotencyKey,
        reason: error instanceof Error ? error.message : "Unknown error",
        sale: {
          ...parsed,
          discountHolder: parsed.discountHolder
            ? { name: parsed.discountHolder.name ?? null, idNumberLast4: parsed.discountHolder.idNumber?.replace(/\s/g, "").slice(-4) ?? null }
            : null,
        },
      });
      return NextResponse.json({ ok: true, parked: true });
    }
    return posErrorResponse(error, "sale");
  }
}

function isPermanentSaleError(error: unknown): boolean {
  if (error instanceof PosError) return true;
  const name = error && typeof error === "object" ? (error as { name?: string }).name : null;
  if (name === "OrderError") return true;
  // A product or shift that no longer exists (foreign key) won't fix itself on retry.
  const code = error && typeof error === "object" ? (error as { code?: string }).code : null;
  return code === "23503";
}
