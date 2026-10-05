import { NextResponse } from "next/server";
import { z } from "zod";
import { getPackingSlips } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

/** Packing slips for ?ids=a,b,c (max 50). */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 50);
    z.array(z.string().uuid()).min(1, "Pick at least one order.").parse(ids);
    const [slips, shop] = [await getPackingSlips(session.tenantId, ids), session.tenantName];
    return NextResponse.json({ ok: true, shop, slips });
  } catch (error) {
    return afterSaleFail(error, "packing slips");
  }
}
