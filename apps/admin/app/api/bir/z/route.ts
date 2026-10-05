import { NextResponse } from "next/server";
import { z } from "zod";
import { createZReading } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { recordActivity } from "@/lib/activity";
import { afterSaleFail } from "@/lib/after-sale";

/** End-of-day Z reading for a register (all shifts closed). */
export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const { registerId } = z.object({ registerId: z.string().uuid() }).parse(await request.json());
    const reading = await createZReading(session.tenantId, registerId, session.displayName ?? "Seller");
    await recordActivity(session, {
      action: "pos.z_reading",
      entityType: "register",
      entityId: registerId,
      summary: `Z reading #${reading.zNumber}: net ₱${reading.totals.netSales.toFixed(2)}, grand total ₱${reading.grandTotalAfter.toFixed(2)}`,
    });
    return NextResponse.json({ ok: true, reading });
  } catch (error) {
    return afterSaleFail(error, "z reading");
  }
}
