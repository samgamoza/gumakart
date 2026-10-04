import { NextResponse } from "next/server";
import { z } from "zod";
import { getPosReceipt } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const actor = await requirePosActor();
    const { saleId } = await params;
    z.string().uuid().parse(saleId);
    const receipt = await getPosReceipt(actor.tenantId, saleId);
    if (!receipt) return NextResponse.json({ ok: false, error: "Sale not found." }, { status: 404 });
    return NextResponse.json({ ok: true, receipt });
  } catch (error) {
    return posErrorResponse(error, "receipt");
  }
}
