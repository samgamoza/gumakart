import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureRegister, getOrReserveInvoiceBlock, PosOfflineError } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

/**
 * BIR on: this device's block of invoice numbers for receipts printed while offline.
 * The register asks while online; `replaceBlockId` = "that block is used up, give me the next".
 */
export async function POST(request: Request) {
  try {
    const actor = await requirePosActor();
    const body = z
      .object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/), replaceBlockId: z.string().uuid().nullish() })
      .parse(await request.json());
    const register = await ensureRegister(actor.tenantId);
    const block = await getOrReserveInvoiceBlock({
      tenantId: actor.tenantId,
      registerId: register.id,
      deviceId: body.deviceId,
      replaceBlockId: body.replaceBlockId ?? null,
    });
    return NextResponse.json({ ok: true, block });
  } catch (error) {
    if (error instanceof PosOfflineError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
    }
    return posErrorResponse(error, "offline block");
  }
}
