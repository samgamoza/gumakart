import { NextResponse } from "next/server";
import { listPosProducts } from "@gumakart/db";
import { posErrorResponse, requirePosActor } from "@/lib/pos-auth";

export async function GET(request: Request) {
  try {
    const actor = await requirePosActor();
    const q = new URL(request.url).searchParams.get("q")?.slice(0, 80) ?? undefined;
    return NextResponse.json({ ok: true, products: await listPosProducts(actor.tenantId, q) });
  } catch (error) {
    return posErrorResponse(error, "products");
  }
}
