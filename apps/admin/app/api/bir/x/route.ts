import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureRegister, getOpenShift, getXReading } from "@gumakart/db";
import { requireTenantSession } from "@/lib/api-auth";
import { afterSaleFail } from "@/lib/after-sale";

/** X reading for ?shiftId= (default: the open shift). Changes nothing. */
export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    let shiftId = new URL(request.url).searchParams.get("shiftId");
    if (shiftId) z.string().uuid().parse(shiftId);
    else {
      const register = await ensureRegister(session.tenantId);
      shiftId = (await getOpenShift(session.tenantId, register.id))?.id ?? null;
    }
    if (!shiftId) return NextResponse.json({ ok: false, error: "No open shift. Pick a shift from the history." }, { status: 404 });
    const reading = await getXReading(session.tenantId, shiftId);
    if (!reading) return NextResponse.json({ ok: false, error: "Shift not found." }, { status: 404 });
    return NextResponse.json({ ok: true, reading });
  } catch (error) {
    return afterSaleFail(error, "x reading");
  }
}
