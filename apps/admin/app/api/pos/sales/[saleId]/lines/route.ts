import { NextResponse } from "next/server";
import { z } from "zod";
import { getAfterSaleView } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

/** Lines of a POS sale with what's already returned (for the register's Return form). */
export async function GET(_request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const view = await getAfterSaleView(actor.tenantId, saleId);
    if (!view || view.sourceChannel !== "pos") return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    return NextResponse.json({ ok: true, view: { lines: view.lines, refundable: view.refundable, canReturn: view.canReturn, reason: view.returnBlockedReason } });
  } catch (error) {
    return posErrorResponse(error, "sale lines");
  }
}
